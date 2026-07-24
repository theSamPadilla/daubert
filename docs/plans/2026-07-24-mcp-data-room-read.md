# MCP Data-Room Read Tools Implementation Plan

**Goal:** Give the MCP (bring-your-own-agent) surface two data-room read tools — `list_data_room_files` and `read_data_room_file` — mirroring the native chat agent's tools, so a local agent connected over MCP can discover and read a case's data-room files and drive the full redlining loop ("drop a file in the data room, ask my local agent to redline it").

## Summary

- **What & why:** Today the MCP surface can create/update/read redline productions and load the `redlining` prompt, but it has **no way to read a data-room file's contents** — an MCP agent can only see file names in the `get_case_data` manifest (capped at 25). This blocks the natural workflow where a user drops a draft in the data room and asks their local MCP agent to review/redline it. This plan adds the two read tools the native chat agent already has.
- **Key product decisions (locked):**
  - MCP read returns **extracted text** for docx/pdf/xlsx/csv/txt and an **MCP image block** for images — NOT Anthropic document blocks (an external agent can't consume our Files API uploads). Text is what redlining and most analysis need.
  - `list_data_room_files` returns the **full** file list (not the 25-file `get_case_data` manifest cap), so an agent can discover any draft.
  - Reads are `viewer`+ gated and access-logged as `agent_read`, identical to the native tool's chain-of-custody.
- **Load-bearing architecture decisions:**
  - Both tools **bypass the 8 KB `truncatedJson` cap** (`tool-utils.ts`) and return content directly — a document read capped at 8 KB would be useless. Text is capped at 600k chars (mirroring the native `EXTRACTED_TEXT_CHAR_LIMIT`) with an explicit truncation suffix.
  - Reuse existing service plumbing: `DataRoomService.getManifest(caseId, limit)` for listing, and a new thin buffer-returning wrapper over the existing `getFileForAgentRead` (which already does size-gating + `agent_read` logging) for reading. A new **pure, provider-neutral extractor** (`file-text.ts`) does docx/pdf/xlsx/csv/txt→text and image passthrough, so it is unit-testable and independent of the Anthropic-specific `attachment-blocks.ts`.
- **Risk concentration:** Task 3 (MCP tool wiring — the 8 KB-cap bypass + MCP content shape + access gating) is the one to review carefully. All tasks are sonnet; opus terminator reviews the whole diff.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/data-room/file-text.ts` | Create | Pure extractor: file bytes+mime → MCP content (text for docx/pdf/xlsx/csv/txt, image block for images), 600k-char cap |
| 2 | `backend/src/modules/data-room/data-room.service.ts` | Modify | `getFileBufferForAgent()` — buffer-returning wrapper over `getFileForAgentRead` (reuses its gating + `agent_read` log) |
| 3 | `backend/src/modules/mcp/tools/read-tools.ts` | Modify | Register `list_data_room_files` + `read_data_room_file` MCP tools (viewer-gated, cap-bypassing content) |
| 4 | `backend/src/modules/mcp/mcp.tools.ts` | Modify | Update the tool-catalog docstring/count (16 → 18 tools) |
| 5 | `backend/src/skills/redlining.md` | Modify | One-line note: the read-draft step works identically on chat and MCP (both have `read_data_room_file`) |
| 6 | `docs/ai-system.md` + `docs/data-room.md` | Modify | MCP tool-surface table gains the two read tools (16 → 18); note MCP data-room read parity |
| 7 | tests: `file-text.spec.ts`, `data-room.service.spec.ts`, `read-tools.spec.ts` | Create/Modify | Unit-cover the extractor, the buffer wrapper, and the two MCP tools |

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task.
>
> **Project rules that override defaults:** NEVER commit — leave all changes in the working tree, `git status` at the end of each task. No `Co-Authored-By` trailers. No DB migration (no schema change). QA is skipped for this feature per operator.

## Shared design reference

### `file-text.ts` contract (Task 1)

```ts
export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };   // data = base64

export const MCP_EXTRACTED_TEXT_CHAR_LIMIT = 600_000;
export const MCP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Convert a data-room file's raw bytes into MCP content blocks. Never throws for
 *  a supported-but-corrupt file — returns a text note block instead. */
export async function extractFileForMcp(
  buffer: Buffer, mimeType: string, name: string,
): Promise<McpContentBlock[]>;
```

Behavior (mirror `attachment-blocks.ts` classification + the redline `redline-extract.ts` extractors):
- **docx** (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) → `mammoth.extractRawText` → text (capped).
- **pdf** (`application/pdf`) → `unpdf` `extractText({ mergePages: false })` joined by `\n\n` → text (capped).
- **xlsx** (`…spreadsheetml.sheet`) → `XLSX` per-sheet `sheet_to_csv`, joined `--- Sheet: <name> ---` → text (capped).
- **csv** (`.csv` + csv mime aliases) / **txt** (`.txt`/`.md` + text aliases) → decode utf8, BOM-strip, latin1 fallback on `�` → text (capped).
- **image** (`image/png|jpeg|gif|webp`) → if `buffer.length ≤ MCP_IMAGE_MAX_BYTES` → `{ type:'image', data: base64, mimeType }`, else a text note.
- **unsupported / corrupt parse** → a single `{ type:'text', text: '[note …]' }` block (never throw).
- Cap: text blocks truncated at `MCP_EXTRACTED_TEXT_CHAR_LIMIT` with `\n\n[truncated at … chars; original was … chars]`.

Reuse the mime constants and CSV/TXT alias sets already defined in `attachment-blocks.ts` (import them if exported; otherwise re-declare the two OOXML mimes locally and keep the alias sets minimal — do not refactor `attachment-blocks.ts`).

### `getFileBufferForAgent` contract (Task 2)

```ts
async getFileBufferForAgent(caseId: string, userId: string, fileId: string, maxBytes: number):
  Promise<
    | { tooLarge: true; name: string; mimeType: string; size: number }
    | { tooLarge: false; name: string; mimeType: string; size: number; buffer: Buffer }
  >
```
Implementation: call the existing `getFileForAgentRead(caseId, userId, fileId, maxBytes)` (which throws `NotFoundException` if absent, gates size — PDF up to 32 MB, others `maxBytes` — and writes the `agent_read` access-log row), and when not `tooLarge`, buffer `read.stream!` via the existing private `streamToBuffer`. Return the shape above. Do NOT re-log or re-gate (the wrapped call already did).

---

## Task 1: Pure file→MCP-content extractor

**Implementer:** sonnet
**Files:** Create `backend/src/modules/data-room/file-text.ts` (+ `file-text.spec.ts`).

**Step 1 — failing tests** (`file-text.spec.ts`):
- docx buffer built in-test with jszip (mirror the redline/docx-redline test builders, or a minimal 2-paragraph docx) → `extractFileForMcp(buf, DOCX_MIME, 'draft.docx')` returns one `{type:'text'}` block whose text contains both paragraphs.
- csv (`Buffer.from('a,b\n1,2')`, mime `text/csv`, name `x.csv`) → text block containing `a,b`.
- txt (mime `text/plain`, name `x.txt`) → text block with the decoded text; a latin1/`�` fallback case prepends the note.
- xlsx built with `XLSX.write` in-test → text block containing the sheet marker + cell values.
- image: a tiny png buffer, mime `image/png`, within cap → `{type:'image', data:<base64>, mimeType:'image/png'}`; an over-cap image (stub `MCP_IMAGE_MAX_BYTES` small via a large buffer) → a text note block.
- unsupported mime (e.g. `application/zip`) → a single text note block (no throw).
- pdf path: unit-test via a stubbed `extractText` (jest.mock `unpdf`) returning `['page one','page two']` → text block `page one\n\npage two`; do not generate a real PDF.
- cap: a >600k-char extraction is truncated with the suffix (drive via a large fake docx/txt).

**Step 2 — run, confirm fail:** `npm run test --prefix backend -- file-text`.

**Step 3 — implement** per the Shared design reference. Pure async function; classification by mime (+ `.csv`/`.txt`/`.md` extension sniff for the ambiguous aliases, same as `attachment-blocks.ts`). Import `extractText`/`getDocumentProxy` from `unpdf`, `mammoth`, `XLSX` (all existing deps).

**Step 4 — pass:** `npm run test --prefix backend -- file-text` green.
**Step 5 —** `git status`.

---

## Task 2: DataRoomService buffer wrapper

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/data-room/data-room.service.ts`; extend `data-room.service.spec.ts`.

**Step 1 — failing tests:** `getFileBufferForAgent(caseId, userId, fileId, maxBytes)`:
- happy path (mock the repo row + `storage.download` returning a stream) → `{ tooLarge:false, name, mimeType, size, buffer }` with the buffered bytes; asserts an `agent_read` log row was written (via the existing logRepo mock pattern).
- oversize file → `{ tooLarge:true, ... }` (no buffer), no throw.
- missing file → propagates `NotFoundException`.

**Step 2 — run, confirm fail.**

**Step 3 — implement** the wrapper per the Shared design reference (delegate to `getFileForAgentRead`, then `streamToBuffer` on the non-tooLarge branch). Keep it directly below `getFileForAgentRead`.

**Step 4 — pass:** `npm run test --prefix backend -- data-room.service` green.
**Step 5 —** `git status`.

---

## Task 3: MCP read tools

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/mcp/tools/read-tools.ts`; extend `read-tools.spec.ts`.

Register two tools in `ReadToolsService.registerAll` (mirror the existing `read_production` registration exactly — `server.registerTool(name, { description, inputSchema }, handler)`, `assertRole(principal, caseId, 'viewer')` as the FIRST awaited call, try/catch → `errorResult(e)`).

Add a module const `const MCP_AGENT_READ_BYTES = 5 * 1024 * 1024;` and `const LIST_FILES_LIMIT = 500;`.

**`list_data_room_files`** — inputSchema `{ caseId: z.string().uuid() }`:
- `assertRole(principal, caseId, 'viewer')`.
- `const manifest = await this.dataRoomService.getManifest(caseId, LIST_FILES_LIMIT);`
- Return the manifest DIRECTLY (NOT `textResult` — the file list can exceed 8 KB): `return { content: [{ type: 'text', text: JSON.stringify(manifest) }] };`. (manifest is `{ files:[{id,name,mimeType,size,folderPath,...}], total, truncated }`; the `truncated` flag already tells the agent if `total > LIST_FILES_LIMIT`.)
- Description: "List every data-room file for a case (id, name, mimeType, size, folder path). Use a file id with read_data_room_file. Returns up to 500 files (see `truncated`). Requires viewer access."

**`read_data_room_file`** — inputSchema `{ caseId: z.string().uuid(), fileId: z.string().uuid() }`:
- `assertRole(principal, caseId, 'viewer')`.
- `const read = await this.dataRoomService.getFileBufferForAgent(caseId, principal.userId, fileId, MCP_AGENT_READ_BYTES);`
- if `read.tooLarge` → return a single text block noting it's too large (name + size + the "PDFs up to 32 MB; others up to 5 MB — ask for an excerpt" guidance), NOT an error.
- else → `const blocks = await extractFileForMcp(read.buffer, read.mimeType, read.name); return { content: blocks };` (blocks are already MCP `{type:'text'|'image'}` — cap-bypassing by construction).
- `NotFoundException` (bad fileId/case) → falls through the try/catch to `errorResult(e)` (message `file_not_found`).
- Description: "Read a data-room file's contents. Pass a fileId from list_data_room_files or the get_case_data manifest. docx/pdf/xlsx/csv/txt are returned as extracted text; images as an image block; large files return a note (PDFs up to 32 MB, other types up to 5 MB). Requires viewer access."

Note on `principal.userId`: the MCP principal is `{ kind:'mcp', userId, organizationId, sessionId }` — `userId` is always present on this surface (unlike the chat `AccessPrincipal` union). Use `principal.userId` directly; if the type is the shared union, narrow with `'userId' in principal ? principal.userId : 'system'` to satisfy the compiler, but on MCP it is always the real userId.

**Step 1 — failing tests** (extend `read-tools.spec.ts`, mirror existing tool tests — they build a server + call tools and mock the injected services):
- `list_data_room_files` → calls `getManifest(caseId, 500)`, returns the manifest JSON in a text block; asserts viewer access asserted.
- `read_data_room_file` happy path: mock `getFileBufferForAgent` → `{ tooLarge:false, name, mimeType:'text/plain', size, buffer: Buffer.from('hello world') }` and (jest.mock or spy) `extractFileForMcp` → `[{type:'text', text:'hello world'}]`; assert the tool returns `{ content:[{type:'text', text:'hello world'}] }` and that it did NOT go through `truncatedJson` (i.e. a >8 KB text is returned in full — include a large-text case asserting length > 8192 survives).
- `read_data_room_file` tooLarge → text note, not isError.
- `read_data_room_file` NotFound → `getFileBufferForAgent` throws `NotFoundException` → result `isError:true` with `file_not_found`.
- both tools assert `caseAccess.assertRole` was called with `'viewer'`.

**Step 2 — run, confirm fail.**

**Step 3 — implement.** Import `extractFileForMcp` from `../../data-room/file-text`.

**Step 4 — pass:** `npm run test --prefix backend -- read-tools` green; `npm run build --prefix backend` green.
**Step 5 —** `git status`.

---

## Task 4: Docs + skill note + tool count

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/mcp/mcp.tools.ts` (tool-catalog docstring / any count), `backend/src/skills/redlining.md`, `docs/ai-system.md`, `docs/data-room.md`. Check `backend/src/modules/mcp/mcp.tools.spec.ts` — if it asserts the exact set/count of registered tools, update it.

- `mcp.tools.ts`: update the header docstring's tool inventory to include the two new read tools (and bump any "16 tools" mention to 18).
- `docs/ai-system.md`: the MCP "Tool surface (16)" table — add `list_data_room_files` + `read_data_room_file` under Read, update the count to 18. Also update the chat-vs-MCP note if it says MCP lacks data-room read.
- `docs/data-room.md`: add a line that data-room file read is now available on BOTH agent surfaces (chat + MCP), viewer-gated, logged `agent_read`.
- `backend/src/skills/redlining.md`: adjust step 1 so it reads correctly for both surfaces — the draft-read step (`read_data_room_file`) now works on chat AND MCP; remove/soften any implication it's chat-only.
- `docs/redlining.md`: if its Agent Surface table claimed MCP could not read the draft file, correct it (MCP now reads via `read_data_room_file`; the baseText snapshot remains available via `read_production`).

**Step —** grep the two MCP tool names appear in the docs; `git status`.

---

## Verification (end-to-end)

1. **Unit:** `npm run test --prefix backend` fully green; `npm run build --prefix backend` exit 0.
2. **Tool registration:** confirm `list_data_room_files` and `read_data_room_file` appear in the MCP registered-tool set (the read-tools tests exercise them; if `mcp.tools.spec.ts` enumerates tools, it now lists 18).
3. **Cap bypass:** the read-tools test asserting a >8 KB document text is returned in full is the key regression guard.
4. QA is intentionally SKIPPED for this feature (operator decision). The natural end-to-end check, for when the operator wants it: connect a local MCP client, `list_data_room_files`, `read_data_room_file` on a docx, then create a redline and drive the ops.

## Engineering decisions made (operator can override)

- **Text (not Anthropic document blocks) over MCP**, images as MCP image blocks — the external agent can't use our Files API; text is what redlining needs.
- **Cap-bypass:** data-room read/list return content directly, not via the 8 KB `truncatedJson` path; text capped at 600k chars with an explicit truncation suffix.
- **Reuse over refactor:** new pure `file-text.ts` extractor rather than refactoring the working Anthropic-specific `attachment-blocks.ts`; `list_data_room_files` reuses `getManifest(caseId, 500)`; `read_data_room_file` reuses `getFileForAgentRead` via a thin buffer wrapper (keeps the `agent_read` log + size gating in one place).
- **500-file list limit** with a `truncated` flag (from `getManifest`) — practically unbounded for real cases, bounded for safety.
- **No new deps, no migration.**
