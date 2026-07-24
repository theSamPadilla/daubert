# Redlining Implementation Plan

**Goal:** Ship a `redline` production type: the AI proposes anchored edit ops against an immutable text snapshot of a draft legal document from the data room (DOCX-first, PDF fallback), the analyst triages each edit in-app, and export writes accepted edits into the original DOCX as real Word tracked changes with margin comments carrying the on-chain basis.

## Summary

- **What & why:** Counsel's draft filings get reviewed against the case's on-chain record. A claude.ai prototype (July 10 MTC letter) proved the review substance works but produced a memo *about* edits, not a redline — structurally, because an LLM cannot reproduce a document verbatim and chat output cannot represent tracked changes. Fix: the model only ever emits anchored edit operations; deterministic server code validates, applies, and renders them. Idea doc: `docs/ideas/redlining.md`.
- **Key product decisions (locked):** DOCX-first input with PDF fallback (PDF yields a clearly-labeled reconstructed redline); in-app triage before anything leaves Daubert; export emits only accepted edits, always as tracked changes, never a silently-applied "clean" document; every edit carries a `basis` surfaced as a Word margin comment.
- **Load-bearing architecture decisions:**
  - `redline` reuses the existing production ops pattern (`parseOp`/`applyOp` discriminated union in `ProductionsService`). No new module topology, no DB migration (`productions.type` is varchar, `data` is jsonb).
  - Base text is snapshotted into `data.baseText` at creation and is **immutable**: full-replace `data` PATCHes are rejected for redlines; only ops mutate them.
  - Anchors resolve server-side by exact-match-after-normalization (curly quotes, ligatures, NBSP, whitespace runs) and must match **exactly one** location within a single paragraph; failures return instructive 400s so the agent self-corrects with a longer quote.
  - The DOCX exporter re-locates anchors by normalized text search inside the OOXML at export time (not by stored offsets), so the tracked-changes writer is decoupled from the snapshot.
- **Risk concentration (opus-tagged tasks): Task 2** (OOXML tracked-changes engine — the spike), **Task 5** (redline ops + immutability guards), **Task 10** (triage UI). All other tasks are sonnet.
- **Checkpoint:** Task 2 is the front-loaded spike. If its output cannot be produced as valid, Word-openable OOXML, STOP after Task 2 and surface the fallback decision (reconstruction-only DOCX export) to the operator before continuing.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/productions/redline-data.ts` | Create | Data shapes, seeding, anchor normalization/resolution — the "model can't drift" core |
| 2 | `backend/src/modules/export/docx-redline.ts` | Create | Real Word tracked changes (`w:ins`/`w:del`) + margin comments written into the original DOCX |
| 3 | `backend/src/modules/productions/redline-ingest.service.ts` | Create | Users create a redline from a data-room DOCX/PDF; server snapshots its text |
| 4 | `backend/src/database/entities/production.entity.ts` | Modify | New `redline` production type (no migration — varchar column) |
| 5 | `backend/src/modules/productions/productions.service.ts` | Modify | `redline_*` atomic ops: propose, triage (accept/reject/modify), document comments; immutability guards |
| 6 | `contracts/schemas/productions.yaml` + `contracts/openapi.yaml` | Modify | `RedlineData` schema + type enum, `$ref`'d from the root spec → typed on both sides via `npm run gen` |
| 7 | `backend/src/modules/export/templates/redline.ts` | Create | Redline HTML rendering (triage preview, PDF export, reconstructed DOCX for PDF sources) |
| 8 | `backend/src/modules/export/redline.controller.ts` | Create | `GET /productions/:id/redline-preview` for the in-app preview pane |
| 9 | `backend/src/modules/export/export.controller.ts` | Modify | Redline export: PDF always; DOCX = tracked-changes gold path for DOCX sources |
| 10 | `backend/src/modules/data-room/data-room.service.ts` | Modify | `getFileForRedline()` — logged, capped, mime-gated byte fetch for snapshot + export |
| 11 | `backend/src/skills/redlining.md` | Create | Agent workflow: verify every claim on-chain before proposing an anchored edit |
| 12 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Chat agent can create redlines and drive redline ops |
| 13 | `backend/src/modules/mcp/mcp.tools.ts` | Modify | MCP parity: `redlining` skill registered as a prompt (tool enums auto-propagate) |
| 14 | `frontend/src/components/Productions/RedlineViewer.tsx` | Create | Triage UI: marked-up document + accept/reject/modify cards with on-chain basis |
| 15 | `frontend/src/utils/redlineSegments.ts` | Create | Pure segment-splitting for rendering base text with inline marks (unit-tested) |
| 16 | `frontend/src/components/Workspace/NewPrimaryModal.tsx` | Modify | Create a redline by picking a draft from the data room |
| 17 | `frontend/src/components/Productions/ProductionViewer.tsx` | Modify | Route `type === 'redline'` to RedlineViewer |
| 18 | `frontend/src/components/Common/ExportModal.tsx` | Modify | Redline exports: pdf + docx |
| 19 | `frontend/src/lib/api-client.ts` | Modify | `'redline'` in the Production type union |
| 20 | `frontend/src/app/cases/[caseId]/(workspace)/productions/page.tsx` | Modify | Redline icon/color in the productions list |
| 21 | `backend/package.json` | Modify | Add `jszip`, `@xmldom/xmldom`, `unpdf` |
| 22 | `docs/redlining.md` + `docs/ai-system.md` + `docs/data-model.md` + `README.md` | Create/Modify | Feature documentation |

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task.
>
> **Project rules that override defaults:** NEVER commit — leave all changes in the working tree and run `git status` at the end of each task. No `Co-Authored-By` trailers ever. No DB migration is needed for this feature (dev uses `synchronize: true`; the `productions` table schema is unchanged). Never run `./migrations.sh`.

## Shared design reference (read before any task)

### RedlineData shape (canonical, mirrored in contracts and `redline-data.ts`)

```ts
export interface RedlineSource {
  fileId: string;        // data_room_files.id at snapshot time
  fileName: string;
  mimeType: string;
  kind: 'docx' | 'pdf';
  extractedAt: string;   // ISO timestamp
}

export interface RedlineAnchor {
  text: string;          // the verbatim quoted span as matched in baseText (raw, not normalized)
  start: number;         // raw char offset into baseText, inclusive
  end: number;           // raw char offset, exclusive
}

export type RedlineEditKind = 'replace' | 'delete' | 'insert_after';
export type RedlineEditStatus = 'proposed' | 'accepted' | 'rejected';

export interface RedlineEdit {
  id: string;            // server-generated UUID
  kind: RedlineEditKind;
  anchor: RedlineAnchor;
  newText: string;       // '' for kind 'delete'
  basis: string;         // the forensic justification (tx hashes, production refs, figures)
  comment?: string;      // optional extra drafting note
  status: RedlineEditStatus;   // always 'proposed' on creation
  origin: 'agent' | 'user';
}

export interface RedlineComment {  // document-level cover note (risk register / open items material)
  id: string;
  title: string;
  text: string;
}

export interface RedlineData {
  schemaVersion: 1;
  source: RedlineSource;
  baseText: string;      // immutable snapshot; paragraphs separated by '\n\n'
  edits: RedlineEdit[];
  comments: RedlineComment[];
}
```

### Anchor semantics (enforced by `resolveAnchor`, Task 1)

- Anchor quotes are normalized before matching: curly quotes → straight, NBSP → space, ligatures fi/fl expanded, all whitespace runs (including newlines) → single space.
- The normalized anchor must be **≥ 8 characters** and match **exactly one** location in the normalized base text. Zero matches → `anchor_not_found`; multiple → `anchor_ambiguous` (message includes the count and tells the caller to quote a longer span).
- The resolved raw span must **not contain `'\n'`** (anchors may not cross paragraph boundaries) — this is what makes the DOCX exporter's per-paragraph search sound.
- Non-`insert_after` edits may not overlap the span of any existing non-rejected non-`insert_after` edit.

### DOCX tracked-changes engine contract (Task 2)

`applyTrackedChangesToDocx(docx: Buffer, edits: RedlineEdit[], opts: { author: string; date: string }): Promise<{ docx: Buffer; failed: { editId: string; anchorText: string; reason: string }[] }>`

- Unzip with `jszip`; parse `word/document.xml` (and `word/footnotes.xml` when present) with `@xmldom/xmldom` DOM so untouched markup round-trips byte-faithfully aside from the edited nodes.
- For each `w:p`, build the paragraph's concatenated `w:t` text with a per-character map back to (run, offset). Search for each edit's **normalized** anchor within the **normalized** paragraph text (same normalizer as Task 1, imported from `redline-data.ts`).
- To apply: split boundary runs at the anchor edges (clone the run, duplicate its `w:rPr`, divide the `w:t` text). Then:
  - `delete`: wrap the anchor's runs in `<w:del w:id="..." w:author="..." w:date="...">`, converting each `w:t` to `w:delText` (preserve `xml:space="preserve"`).
  - `replace`: as delete, then insert `<w:ins w:id="..." w:author w:date>` containing one new run (cloning the first deleted run's `w:rPr`) with the `newText`, immediately after the `w:del`.
  - `insert_after`: only the `w:ins` run, placed after the anchor's last run.
- Comments: ensure `word/comments.xml` exists (create with the `w:comments` root; add the `[Content_Types].xml` override `application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml` and a relationship in `word/_rels/document.xml.rels` of type `http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments`). For each edit: `w:commentRangeStart`/`w:commentRangeEnd` around the changed region plus a run with `w:commentReference`; the comment body = `basis` (+ `comment` if present), author `Daubert`.
- Revision/comment `w:id`s: use a counter starting at 9001 (well clear of existing ids).
- An edit whose anchor cannot be uniquely located in the XML goes into `failed` (do not throw); the caller decides.
- **Never applied silently:** the function only ever emits tracked `w:ins`/`w:del`, never plain text replacement.

### Ops surface added in Task 5

```
{ op: 'redline_add_edit', kind: 'replace'|'delete'|'insert_after', anchorText, newText?, basis, comment?, origin? }
{ op: 'redline_update_edit', editId, status?, newText?, basis?, comment? }   // triage + modify; anchor/kind immutable
{ op: 'redline_remove_edit', editId }
{ op: 'redline_add_comment', title, text }
{ op: 'redline_update_comment', commentId, title?, text? }
{ op: 'redline_remove_comment', commentId }
```

---

## Task 1: Redline data core — types, seed, anchor resolution

**Implementer:** sonnet
**Files:** Create `backend/src/modules/productions/redline-data.ts`; Create `backend/src/modules/productions/redline-data.spec.ts`

**Step 1 — failing tests** (`redline-data.spec.ts`), covering at minimum:
- `normalizeForAnchor('“Sun’s wallets”')` equals `'"Sun\'s wallets"'`; NBSP → space; `ﬁnancial` → `financial`; runs of spaces/newlines collapse to one space.
- `resolveAnchor(base, quote)` returns the raw `{ start, end }` for a unique match even when the base text uses curly quotes and the quote uses straight ones (and vice versa).
- Zero matches → `{ error: 'anchor_not_found' }`; two matches → `{ error: 'anchor_ambiguous', count: 2 }`; normalized quote shorter than 8 chars → `{ error: 'anchor_too_short' }`; matched raw span containing `\n` → `{ error: 'anchor_crosses_paragraphs' }`.
- `spansOverlap` truth table incl. adjacency (touching spans do NOT overlap).
- `seedRedlineData(source, baseText)` returns `{ schemaVersion: 1, source, baseText, edits: [], comments: [] }`.

**Step 2 — run, confirm fail:** `npm run test --prefix backend -- redline-data` → module-not-found / assertion failures.

**Step 3 — implementation.** Complete core (write exactly this logic; helpers may be arranged freely):

```ts
// redline-data.ts
const CHAR_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"',
  ' ': ' ', '‑': '-', 'ﬁ': 'fi', 'ﬂ': 'fl',
};

export const MIN_ANCHOR_LENGTH = 8;

/** Normalize text for anchor matching. Whitespace runs collapse to one space. */
export function normalizeForAnchor(s: string): string {
  return mapChars(s).replace(/\s+/g, ' ').trim();
}

function mapChars(s: string): string {
  let out = '';
  for (const ch of s) out += CHAR_MAP[ch] ?? ch;
  return out;
}

interface NormalizedIndex { text: string; starts: number[]; ends: number[] }

/** Build normalized text plus per-normalized-char raw [start,end) offsets. */
export function buildNormalizedIndex(raw: string): NormalizedIndex {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  const chars = Array.from(raw); // code-point iteration
  while (i < chars.length) {
    const ch = chars[i];
    if (/\s/.test(ch) || ch === ' ') {
      let j = i;
      while (j < chars.length && (/\s/.test(chars[j]) || chars[j] === ' ')) j++;
      if (text.length > 0) { text += ' '; starts.push(rawOffset(chars, i)); ends.push(rawOffset(chars, j)); }
      i = j;
      continue;
    }
    const mapped = CHAR_MAP[ch] ?? ch;
    for (const m of mapped) { text += m; starts.push(rawOffset(chars, i)); ends.push(rawOffset(chars, i + 1)); }
    i++;
  }
  // trim trailing collapsed space
  if (text.endsWith(' ')) { text = text.slice(0, -1); starts.pop(); ends.pop(); }
  return { text, starts, ends };
}

function rawOffset(chars: string[], idx: number): number {
  // chars are code points; convert code-point index back to UTF-16 offset
  let off = 0;
  for (let k = 0; k < idx; k++) off += chars[k].length;
  return off;
}

export type AnchorResolution =
  | { start: number; end: number }
  | { error: 'anchor_too_short' | 'anchor_not_found' | 'anchor_crosses_paragraphs' }
  | { error: 'anchor_ambiguous'; count: number };

export function resolveAnchor(baseText: string, anchorText: string): AnchorResolution {
  const needle = normalizeForAnchor(anchorText);
  if (needle.length < MIN_ANCHOR_LENGTH) return { error: 'anchor_too_short' };
  const idx = buildNormalizedIndex(baseText);
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const p = idx.text.indexOf(needle, from);
    if (p < 0) break;
    positions.push(p);
    from = p + 1;
  }
  if (positions.length === 0) return { error: 'anchor_not_found' };
  if (positions.length > 1) return { error: 'anchor_ambiguous', count: positions.length };
  const p = positions[0];
  const start = idx.starts[p];
  const end = idx.ends[p + needle.length - 1];
  if (baseText.slice(start, end).includes('\n')) return { error: 'anchor_crosses_paragraphs' };
  return { start, end };
}

export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function seedRedlineData(source: RedlineSource, baseText: string): RedlineData {
  return { schemaVersion: 1, source, baseText, edits: [], comments: [] };
}
```

Performance note: `rawOffset` as written is O(n²) over the base text; implement it with a precomputed prefix-offset array instead (single pass) — the tests should include a 200KB base text resolving in <200ms.

Include the full type definitions from the Shared design reference in this file (exported).

**Step 4 — run tests, confirm pass:** `npm run test --prefix backend -- redline-data`.
**Step 5 —** `git status`.

---

## Task 2: SPIKE — DOCX tracked-changes engine

**Implementer:** opus
**Files:** Create `backend/src/modules/export/docx-redline.ts`; Create `backend/src/modules/export/docx-redline.spec.ts`; Modify `backend/package.json` (add `jszip`, `@xmldom/xmldom`)

This is the highest-risk task in the plan. Follow the engine contract in the Shared design reference exactly. Import the normalizer from `../productions/redline-data`.

**Step 1 — install deps:** `npm install --prefix backend jszip @xmldom/xmldom`.

**Step 2 — failing tests.** Build synthetic DOCX buffers **in the test** with jszip (no binary fixtures): a minimal package (`[Content_Types].xml`, `_rels/.rels`, `word/_rels/document.xml.rels`, `word/document.xml`) whose document has 3 paragraphs, one of which splits a sentence across two runs with distinct `w:rPr` (e.g. second run bold), and one containing `990 trillion supply` with a curly-quote neighbor. Tests:
1. `replace` on a span contained in one run → output XML contains `<w:del>` wrapping a `<w:delText>` with the anchor text and an adjacent `<w:ins>` whose run text is the newText; the paragraph's surrounding text is byte-identical.
2. `replace` on a span crossing the run boundary → both fragments appear inside `w:del`, boundary runs split, `w:rPr` of the bold run preserved on its fragment.
3. `delete` → `w:del` only, no `w:ins`.
4. `insert_after` → `w:ins` only, placed after the anchor run, cloning the anchor run's `w:rPr`.
5. Comments: output zip contains `word/comments.xml` with the basis text, `[Content_Types].xml` gains the comments override, `document.xml.rels` gains the relationship, and `document.xml` contains `commentRangeStart`/`End` + `commentReference` with matching ids.
6. Unlocatable anchor → returned in `failed`, other edits still applied.
7. Round-trip integrity: run `mammoth.extractRawText` on the output buffer — extracted text still contains all unedited paragraphs verbatim (mammoth ignores `w:delText`, so a `replace` shows the inserted text and not the deleted text).
8. Output re-parses with xmldom with zero parse errors, and every `w:id` used is unique.

**Step 3 — implement** per the contract. Keep the module pure (Buffer in/out, no Nest injection). Export a small `escapeXml` helper if needed. Manual QA of Word-validity happens in the Verification phase (open in Word/Pages); the automated tests assert ECMA-376 structure.

**Step 4 — run:** `npm run test --prefix backend -- docx-redline` → green. Also run `npm run build --prefix backend`.

**Step 5 —** `git status`.

> **CHECKPOINT (operator):** If Step 3 cannot satisfy the tests with spec-conformant OOXML, STOP the plan here and surface the fallback decision (ship reconstruction-only DOCX export) rather than working around it.

---

## Task 3: Text extraction — DOCX (mammoth) + PDF (unpdf)

**Implementer:** sonnet
**Files:** Create `backend/src/modules/productions/redline-extract.ts`; Create `backend/src/modules/productions/redline-extract.spec.ts`; Modify `backend/package.json` (add `unpdf`)

**Step 1:** `npm install --prefix backend unpdf`.

**Step 2 — failing tests:** build a docx buffer in-test (jszip, as Task 2) with three paragraphs → `extractBaseText(buf, DOCX_MIME)` resolves `{ kind: 'docx', text }` where paragraphs are separated by `\n\n` and CRLF is normalized to LF. Unsupported mime → throws `BadRequestException`. (PDF path: unit-test the page-joining/normalization wrapper with a stubbed `extractText`; do not fight PDF generation in-test.)

**Step 3 — implement:**

```ts
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function extractBaseText(buffer: Buffer, mimeType: string): Promise<{ kind: 'docx' | 'pdf'; text: string }> {
  if (mimeType === DOCX_MIME) {
    const { value } = await mammoth.extractRawText({ buffer });
    return { kind: 'docx', text: normalizeNewlines(value) };
  }
  if (mimeType === 'application/pdf') {
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(buffer)), { mergePages: false });
    return { kind: 'pdf', text: normalizeNewlines((text as string[]).join('\n\n')) };
  }
  throw new BadRequestException(`Unsupported redline source type: ${mimeType}. Upload a .docx (preferred) or .pdf.`);
}
```

`normalizeNewlines`: CRLF/CR → LF, strip trailing whitespace per line, collapse 3+ consecutive LFs to 2.

**Step 4:** `npm run test --prefix backend -- redline-extract` → green.
**Step 5 —** `git status`.

---

## Task 4: Entity + contracts + creation seeding

**Implementer:** sonnet
**Files:** Modify `backend/src/database/entities/production.entity.ts` (add `REDLINE = 'redline'`); Modify `contracts/schemas/productions.yaml` **and `contracts/openapi.yaml`**; Create `backend/src/modules/productions/redline-ingest.service.ts`; Modify `backend/src/modules/productions/productions.service.ts` (create branch + constructor), `backend/src/modules/productions/productions.module.ts`, `backend/src/modules/data-room/data-room.service.ts`, `backend/src/modules/data-room/data-room.module.ts` (export `DataRoomService` if not already); tests in `productions.service.spec.ts` + `redline-ingest.service.spec.ts`.

**Canonical signatures for this task (used verbatim by Task 7 and this task's create branch):**

```ts
// data-room.service.ts
async getFileForRedline(caseId: string, fileId: string, actorUserId: string):
  Promise<{ name: string; mimeType: string; buffer: Buffer }>

// redline-ingest.service.ts
async buildData(caseId: string, sourceFileId: string, actorUserId: string): Promise<RedlineData>
```

**Step 1 — failing tests:**
- `ProductionsService.create` with `{ type: 'redline', data: { sourceFileId } }` (RedlineIngestService mocked) persists seeded `RedlineData` with `source.kind === 'docx'`, correct `baseText`, empty `edits`/`comments`; `sourceFileId` missing → 400; file from another case → the underlying NotFound propagates.
- `DataRoomService.getFileForRedline(caseId, fileId, actorUserId)`: returns `{ name, mimeType, buffer }`; rejects mime other than docx/pdf (400) and size > 20MB (400); writes a `download` access-log row attributed to `actorUserId` (assert via the existing spec's log-repo mock pattern in `data-room.service.spec.ts`).

**Step 2 — run, confirm fail.**

**Step 3 — implement:**
- Entity: add `REDLINE = 'redline'` to `ProductionType`.
- Contracts: in `contracts/schemas/productions.yaml`, add `redline` to `ProductionType.enum` and append `RedlineSource`, `RedlineAnchor`, `RedlineEdit` (with `kind`/`status` enums), `RedlineComment`, `RedlineData` schemas mirroring the Shared design reference (same style as `DeclarationData`). **Then in `contracts/openapi.yaml` `components.schemas`, add a `$ref` entry for each new schema** (pattern-match the existing `DeclarationData: { $ref: './schemas/productions.yaml#/DeclarationData' }` entries around lines 290–318) — without these, codegen will not emit the types. Run `npm run gen` and confirm both `src/generated/api-types.ts` files pick up `RedlineData`.
- `DataRoomService.getFileForRedline` (signature above): findOne by `{ id: fileId, caseId }` (404 if absent), gate mime ∈ {DOCX_MIME, application/pdf} and size ≤ 20MB (400 otherwise), `this.storage.download(row.objectKey)` then buffer via a **new private `streamToBuffer(stream)` helper added to `data-room.service.ts`** (none exists in this module — do not import from `ai.service.ts`, whose helper is private), then `await this.log(caseId, actorUserId, 'download', fileId)`.
- `RedlineIngestService` (new provider registered in `ProductionsModule`; `ProductionsModule` imports `DataRoomModule`; constructor injects `DataRoomService`): `buildData(caseId, sourceFileId, actorUserId)` → `getFileForRedline` → `extractBaseText` (Task 3) → `seedRedlineData({ fileId, fileName, mimeType, kind, extractedAt: new Date().toISOString() }, text)`.
- `ProductionsService`: add `private readonly redlineIngest: RedlineIngestService` to the constructor, then the create branch before the generic fallback:
  ```ts
  } else if (dto.type === ProductionType.REDLINE) {
    const sourceFileId = (dto.data as any)?.sourceFileId;
    if (typeof sourceFileId !== 'string' || !sourceFileId) {
      throw new BadRequestException('redline productions require data.sourceFileId');
    }
    const actorUserId = 'userId' in principal ? principal.userId : 'system';
    data = (await this.redlineIngest.buildData(caseId, sourceFileId, actorUserId)) as unknown as Record<string, unknown>;
  }
  ```
  (`AccessPrincipal` is a union; the `script` variant has no `userId`, hence the `'userId' in principal` narrowing with `'system'` fallback.)

**Step 4:** `npm run test --prefix backend -- "productions.service|redline-ingest|data-room.service"` → green; `npm run gen` → both generated files gain the Redline schemas; `npm run build --prefix backend`.
**Step 5 —** `git status`.

---

## Task 5: Redline ops in ProductionsService

**Implementer:** opus
**Files:** Modify `backend/src/modules/productions/productions.service.ts`; tests in `productions.service.spec.ts`.

**Step 1 — failing tests** (extend the existing ops describe-block patterns):
- `redline_add_edit` (replace) resolves the anchor, appends an edit with server UUID, `status: 'proposed'`, default `origin: 'agent'`, stored `anchor.text` = the **raw matched span** (`baseText.slice(start, end)`).
- Ambiguous anchor → 400 whose message contains `anchor_ambiguous`, the match count, and the phrase `quote a longer span`; not-found → 400 naming `anchor_not_found`; `delete` with non-empty `newText` → 400; `insert_after` requires non-empty `newText`; missing/empty `basis` → 400.
- Overlap: second non-insert edit overlapping a `proposed` or `accepted` edit → 400; overlapping a `rejected` edit → allowed; `insert_after` at any position → allowed.
- `redline_update_edit`: status transitions proposed↔accepted↔rejected all allowed; `newText`/`basis`/`comment` patchable; unknown editId → 400; attempts to pass `anchorText`/`kind` → 400 (anchor immutable).
- `redline_remove_edit`, `redline_add_comment`/`update`/`remove` behave like their declaration analogues.
- Type gating: any `redline_*` op on a non-redline production → 400 (prefix gate).
- **Immutability guards:** `update()` with `data` (full replace) on a redline production → 400 `redline productions are ops-only`; `update()` changing `type` to or from `redline` → 400.

**Step 2 — run, confirm fail.**

**Step 3 — implement.** Extend the `Op` union, `parseOp`, and `applyOp` following the existing declaration op style exactly (same error-message format `ops[${i}] (op_name): ...`). Add the prefix gate `op.op.startsWith('redline_') && type !== ProductionType.REDLINE` beside the existing three. Implement the two guards in `update()` before the data/ops dispatch. Anchor resolution and overlap checks call Task 1's helpers; on `redline_add_edit` re-derive `anchor.text` from the resolved raw span so the stored quote is verbatim-from-base. Keep `applyOp` pure (return new data object).

**Step 4:** `npm run test --prefix backend -- productions.service` → green.
**Step 5 —** `git status`.

---

## Task 6: Redline HTML template + preview endpoint + PDF export

**Implementer:** sonnet
**Files:** Create `backend/src/modules/export/templates/redline.ts` (+ `redline.spec.ts`); Create `backend/src/modules/export/redline.controller.ts`; Modify `backend/src/modules/export/export.module.ts`, `backend/src/modules/export/export.controller.ts` (pdf + reconstructed-docx paths only; the tracked-changes docx path is Task 7).

**Step 1 — failing tests:**
- `renderRedlineHtml(data, { mode: 'triage' })`: HTML-escapes base text; renders paragraphs from `\n\n`; a `replace` edit renders `<del>` + `<ins>` spans with `data-edit-id` and a `status-*` class; rejected edits render with a `status-rejected` class; each edit emits a superscript marker linked to an endnote listing kind, basis, and comment; document-level comments render in a "Reviewer notes" section; a header block shows production name, source file name, and proposed/accepted/rejected counts.
- `{ mode: 'accepted' }`: only accepted edits render as marks (proposed/rejected base text renders unmarked); the header carries the label `Redline — accepted edits`. Snapshot tests in `templates/__snapshots__` like the sibling templates.
- Controller specs (extend `export.controller.spec.ts`): redline+pdf allowed; redline+png/csv → 400; preview route 400s for non-redline productions.

**Step 2 — run, confirm fail.**

**Step 3 — implement:**
- `renderRedlineHtml(data: RedlineData, opts: { mode: 'triage' | 'accepted' })`: split `baseText` into paragraphs; compute per-paragraph segments from the (non-overlapping) sorted edit spans; reuse `styles.ts` shared CSS helpers; `<del>`/`<ins>` styling — red strikethrough / red underline (match legal redline conventions; use plain CSS colors here, this is print output). If `source.kind === 'pdf'`, render a banner: `Reconstructed redline — layout is not the original document`.
- `redline.controller.ts`: mirror `declaration-formats.controller.ts` preview exactly — `GET /productions/:id/redline-preview?mode=triage|accepted` (default `triage`), case access via `productionsService.findOne`, 400 on wrong type, `Content-Type: text/html`. Register in `export.module.ts` controllers.
- `export.controller.ts`: `ALLOWED` gains `redline: ['pdf', 'docx']`; the html `switch` gains `case 'redline': html = renderRedlineHtml(data, { mode: 'accepted' })`. PDF renders portrait Letter (`pageFormat: 'Letter'`, 1in margins). For docx in this task, route ALL redlines through `htmlToDocx(html)` (reconstructed) — Task 7 upgrades the docx-source path.

**Step 4:** `npm run test --prefix backend -- "redline|export.controller"` → green.
**Step 5 —** `git status`.

---

## Task 7: Gold-path DOCX export wiring

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/export/export.controller.ts`, `backend/src/modules/export/export.module.ts` (import `DataRoomModule`); tests in `export.controller.spec.ts`.

**Step 1 — failing tests:** redline+docx with `source.kind === 'docx'` → controller fetches source bytes via `getFileForRedline(production.caseId, source.fileId, userId)` (the `userId` from the controller's existing `getUserId(req)`), calls `applyTrackedChangesToDocx` with **only accepted edits** and `{ author: 'Daubert', date: <ISO now> }`, streams the returned buffer with the docx content type. If `failed.length > 0` → 400 listing each failed edit's anchor quote. `source.kind === 'pdf'` → reconstructed `htmlToDocx` path (from Task 6) with filename suffix `_reconstructed`. Zero accepted edits → 400 `No accepted edits to export` on **both docx paths** (docx-source and pdf-source); the PDF export format has no such guard (an unmarked accepted-mode PDF is valid output).

**Step 2 — run, confirm fail.**

**Step 3 — implement** in the docx branch of `exportProduction` before the generic `htmlToDocx` call. Deleted-source tolerance: if the data-room row is gone (404 from `getFileForRedline`), return 400 `Source document no longer in the data room — export PDF instead` (the PDF path needs no source bytes).

**Step 4:** `npm run test --prefix backend -- export.controller` → green; `npm run build --prefix backend`.
**Step 5 —** `git status`.

---

## Task 8: Agent surface — chat tools, skill, MCP parity

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/ai/tools/tool-definitions.ts`; Create `backend/src/skills/redlining.md`; Modify `backend/src/skills/productions.md` (one pointer line), `backend/src/modules/mcp/mcp.tools.ts` (`PROMPT_SKILL_HANDLES` += `'redlining'`), **`backend/src/modules/mcp/tools/write-tools.ts` (description strings)**; verify `backend/src/modules/mcp/tools/read-tools.ts` type enum (both tools files use `z.nativeEnum(ProductionType)` for enums — those auto-propagate; only hardcoded lists need touching).

**MCP description parity:** the zod enums auto-propagate, but the hardcoded English `description` strings on the MCP `create_production` and `update_production` registrations in `write-tools.ts` do not — update both: `create_production`'s description gains redline (source file id, "load the `redlining` prompt first"), `update_production`'s gains a one-line pointer to the redline ops (full shapes live in the `redlining` skill/prompt to keep the MCP description compact).

**Step 1 — failing test:** extend the skill-registry spec pattern (or add one) asserting `SKILL_NAMES` includes `redlining`; extend `mcp.tools.spec.ts` prompt-registration assertion to include `redlining`.

**Step 2 — implement:**
- `CREATE_PRODUCTION_TOOL`: add `redline` to the `type` enum; append to the `data` description: `**For redline:** pass { sourceFileId } — a data-room file id for the draft to review (.docx preferred, .pdf fallback). The server snapshots the document text; you then propose edits with update_production redline ops. Load the redlining skill first.`
- `UPDATE_PRODUCTION_TOOL`: document the six redline ops (shapes from the Shared design reference), with the three laws: quote anchors **verbatim from the document, ≥ 8 chars, within one paragraph**; on `anchor_ambiguous`/`anchor_not_found` retry once with a longer exact quote; every edit's `basis` must cite the specific on-chain fact (tx hash, figures, production name) that justifies it.
- `READ_PRODUCTION_TOOL`: add `declaration` and `redline` to the type-filter enum.
- `backend/src/skills/redlining.md` (frontmatter `name: redlining`, description one-liner). Body teaches the workflow:
  1. Find the draft (`get_case_data` manifest / `list_data_room_files`) and read it (`read_data_room_file`) for full context.
  2. Create the redline production (`create_production` type `redline`, `data.sourceFileId`).
  3. **Verify before proposing:** every factual/on-chain assertion in the draft (supply figures, tx hashes, wallet characterizations, valuations) gets checked against the case record — `get_investigation`, `query_labeled_entities`, `execute_script`, prior productions via `read_production` — BEFORE an edit is proposed. No edit without a verified basis.
  4. Propose with `redline_add_edit`: one factual issue per edit; smallest span that contains the problem; `newText` in the document's own voice; `basis` cites the evidence.
  5. Memo-grade material (risk flags, open items, strategic cautions) goes in `redline_add_comment` document comments — never into edit text.
  6. Never regenerate or restate the document; the user triages your proposals in the UI and only accepted edits export.
- `productions.md` skill: add one line pointing to the `redlining` skill for draft-review work.

**Step 3:** `npm run test --prefix backend -- "skill|mcp.tools"` → green; `npm run build --prefix backend`.
**Step 4 —** `git status`.

---

## Task 9: Frontend — type registration + creation flow

**Implementer:** sonnet
**Files:** Modify `frontend/src/lib/api-client.ts` (line ~220: add `'redline'` to `Production.type`), `frontend/src/components/Workspace/NewPrimaryModal.tsx`, `frontend/src/app/cases/[caseId]/(workspace)/productions/page.tsx` (TYPE_ICONS/TYPE_COLORS), `frontend/src/components/Productions/ProductionViewer.tsx` (its icon/color maps only — the viewer branch is Task 10), `frontend/src/components/Common/ExportModal.tsx` (`ExportKind` + `FORMATS_BY_KIND: redline: ['pdf', 'docx']`).

**Implementation notes:**
- `NewPrimaryModal.tsx`: extend the `ProductionType` union and the button grid (`['report','chart','chronology','declaration','redline']`). When `redline` is selected, render a source-picker section (pattern-match the existing declaration-format section): fetch `apiClient.dataRoomListFiles(caseId)` on selection, filter to mime docx/pdf, list as radio rows (file icon per `fileMeta` conventions, name, size, "DOCX — tracked-changes export" vs "PDF — reconstructed redline" hint), disable Create until a file is chosen. Create posts `data: { sourceFileId }`. Empty state: "No .docx or .pdf files in the data room yet — upload the draft first."
- Icons: `FaFilePen` (fa6) for redline everywhere; color: the existing `redline` Tailwind token (`text-redline`).
- Typecheck/tests: `npm run build --prefix frontend` and `npm test --prefix frontend` stay green.

`git status` at end.

---

## Task 10: Frontend — RedlineViewer triage UI

**Implementer:** opus
**Files:** Create `frontend/src/components/Productions/RedlineViewer.tsx`; Create `frontend/src/utils/redlineSegments.ts` (+ `redlineSegments.test.ts`); Modify `frontend/src/components/Productions/ProductionViewer.tsx` (add the `production.type === 'redline'` branch at the type switch, ~line 482, passing `production` and `onUpdate`). Editability: `ProductionViewer` has no `canMutate` prop — the page gates mutations upstream; follow the same-file convention the other branches use (edit affordances render when the mutation callbacks are provided; the page at `productions/page.tsx:39` computes `canMutate` and can pass `onUpdate` conditionally). RedlineViewer renders read-only (no action buttons) when its mutation callback is absent.

**Step 1 — failing tests** (`redlineSegments.test.ts`, jest/jsdom like `utils/declarationNumbering.test.ts`): `buildRedlineSegments(baseText, edits, statusFilter)` → paragraphs array, each a list of segments `{ text, role: 'context' | 'del' | 'ins', editId?, status? }`; a replace edit yields adjacent del+ins segments; insert_after yields ins only; edits excluded by the filter yield plain context; segments never split surrogate pairs; edits sorted by `anchor.start` regardless of input order.

**Step 2 — implement the util, confirm green:** `npm test --prefix frontend -- redlineSegments`.

**Step 3 — implement the viewer.** Layout (Tailwind semantic tokens, `src/components/ui` primitives, fa6 icons):
- **Header row:** status counts as `Badge`s (`n proposed / n accepted / n rejected`), a filter segmented control (All / Proposed / Accepted / Rejected — pattern-match the declaration Edit/View/Preview control in `ProductionViewer.tsx:430-450`), and a "Reviewer notes" disclosure listing `data.comments` (title + text; editable via `redline_update_comment`/`redline_remove_comment` when editable).
- **Two panes:** left = document pane rendering `buildRedlineSegments` output — serif-ish readable body (`font-sans` is fine; match ReportEditor's prose styling), `<del>` red strikethrough / `<ins>` red underline using the `redline` token; `status-proposed` marks get a dashed amber outline; `status-rejected` dimmed. Clicking a mark selects its card (scroll + ring). Right = scrollable card rail, one card per edit in document order: kind badge, the anchored quote (truncated, mono), arrow, `newText`, **basis** block (mono, `surface-raised`), optional comment, origin tag; footer buttons Accept (`FaCheck`, primary) / Reject (`FaXmark`, ghost/danger) / Modify (`FaPenToSquare`) — Modify opens a `Modal` with `Textarea`s for `newText` and `comment`. Accepted/rejected cards show an Undo (back to proposed).
- **Mutations:** every action = `apiClient.updateProduction(production.id, { ops: [{ op: 'redline_update_edit', editId, ... }] })` → `onUpdate(updated)`, exactly the chronology pattern at `ProductionViewer.tsx:243-255`, with the same `lastError` banner pattern on failure. Read-only mode (viewer role): cards render without action buttons.
- `production_updated` SSE → CaseContext refresh already re-renders this component with fresh data; no extra wiring.

**Step 4:** `npm run build --prefix frontend` green; `npm test --prefix frontend` green.
**Step 5 —** `git status`.

---

## Task 11: Documentation

**Implementer:** sonnet
**Files:** Create `docs/redlining.md` (mirror `docs/declarations.md` structure: production type, data shape, ops table, anchor semantics, ingest, triage flow, export paths incl. the failed-anchor 400 and deleted-source behavior, agent surface table); Modify `docs/ai-system.md` (tools table: create_production/update_production/read_production descriptions mention redline; skills table: add `redlining` row; MCP prompts list); Modify `README.md` (Data Model supporting-entities line unchanged; add redline to the productions mention if present); Modify `docs/data-model.md` if it enumerates production types.

`git status` at end.

---

## Verification (end-to-end)

1. **Unit:** `npm run test --prefix backend` and `npm test --prefix frontend` fully green; `npm run build` on both sides.
2. **Codegen:** `npm run gen` produces no unexpected diff beyond the new Redline schemas.
3. **Manual QA** (use the `/qa` skill; `npm run db`, `npm run be`, `npm run fe`):
   - Upload a real `.docx` draft (any multi-paragraph letter with footnotes) to a case data room.
   - Create a redline from the productions workspace → New → Redline → pick the file. Confirm the viewer shows the snapshot text.
   - In AI chat: *"Load the redlining skill and review the draft against the case record; propose redline edits."* Confirm edits appear as proposed cards via the `production_updated` refresh, anchored correctly, with basis text.
   - Triage: accept one, reject one, modify one. Refresh the page — states persist.
   - Export PDF → marks render, only accepted edits in `accepted` mode.
   - Export DOCX → **open in Word (or Pages/LibreOffice)**: tracked changes appear under the author "Daubert", accept/reject works natively, margin comments carry the basis. This validates the Task 2 spike end-to-end.
   - PDF-source path: create a redline from a PDF, confirm the "reconstructed" banner and `_reconstructed` docx filename.
   - Negative: ask the agent to redline with a vague quote — confirm the 400 message loops it into retrying with a longer quote; try a full-replace `data` PATCH on a redline via the API — 400.

## Engineering decisions made (operator can override)

- **Anchors may not cross paragraph boundaries** — keeps DOCX anchor relocation per-paragraph and sound; the skill instructs the agent accordingly.
- **Export-time anchor relocation by normalized text search** in the OOXML (not stored offsets) — decouples snapshot from surgery; failed relocations 400 the export with the offending quotes rather than exporting a partial file.
- **Full-replace `data` PATCH rejected for redlines; `type` transitions to/from redline rejected** — base-text immutability is enforced server-side, not by convention.
- **`redline_add_edit` is available to users via API** (origin `'user'`) but the MVP UI has no select-text-to-add-edit affordance — deferred.
- **Source cap 20MB, mime gate docx/pdf**, access-logged as `download`.
- **New deps:** `jszip` + `@xmldom/xmldom` (OOXML surgery), `unpdf` (PDF text extraction). `mammoth` (already present) does DOCX extraction.
- **No DB migration** — `productions.type` is varchar and `data` is jsonb; nothing schema-level changes.
