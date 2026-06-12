# Agent tooling: large PDFs via Files API + case-scoped scripts

Fixes the two access failures the in-app agent hit on the Rossi case:

1. **6.5 MB PDF "too large to read inline"** — PDFs are the only attachment type sent as raw base64 bytes (no extraction/fallback), so once a PDF exceeds Anthropic's ~4.5 MB base64 `document` limit it hard-rejects. A separate 5 MB gate (`MAX_AGENT_READ_BYTES`) rejects it even before download.
2. **`execute_script` → "No investigation selected"** — script runs require an `investigationId` only because `script_runs.investigation_id` is `NOT NULL`. The sandbox token and the Data Room it reads are **case-scoped**; the investigation requirement is an artificial persistence coupling.

**Decisions (confirmed with user):**
- Oversized PDFs → upload to **Anthropic Files API**, reference by `file_id` (full vision preserved, no base64 size barrier).
- Scripts → **case-scoped** (`investigation_id` becomes optional). Runs file under the case; an investigation tag is kept when one is selected.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/ai/providers/anthropic.provider.ts` | Modify | Add `files-api-2025-04-14` beta so `file_id` document blocks are accepted; add `uploadFile()` to push a buffer to the Files API and return its id |
| 2 | `backend/src/modules/ai/providers/llm-provider.interface.ts` | Modify | Declare `uploadFile()` on the provider interface |
| 3 | `backend/src/modules/ai/attachment-blocks.ts` | Modify | PDFs over the base64 limit upload via an injected uploader and emit a `{source:{type:'file',file_id}}` document block instead of a "too large" stub |
| 4 | `backend/src/database/entities/data-room-file.entity.ts` | Modify | Add nullable `anthropic_file_id` — cache the uploaded id so re-reads of the same evidence file don't re-upload |
| 5 | `backend/src/modules/data-room/data-room.service.ts` | Modify | `getFileForAgentRead` returns the cached `anthropicFileId`; add `setAnthropicFileId()` |
| 6 | `backend/src/modules/ai/ai.service.ts` | Modify | Type-aware read ceiling (PDF→32 MB, else 5 MB); oversized PDFs read through a caching uploader; **`execute_script` guard requires only `caseId`**; `list_script_runs` lists by case |
| 7 | `backend/src/database/entities/script-run.entity.ts` | Modify | `investigation_id` nullable (`SET NULL`), add `case_id` (`CASCADE`) |
| 8 | `backend/src/database/entities/case.entity.ts` | Modify | `OneToMany` scriptRuns (cascade owner) |
| 9 | `backend/src/database/entities/investigation.entity.ts` | Modify | scriptRuns relation nullable / `SET NULL` |
| 10 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | `execute(caseId, investigationId?, …)` sets `case_id`; add `listRunsForCase(caseId)` |
| 11 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Reword `execute_script` / `list_script_runs` to case scope; note PDFs of any size are now readable |
| 12 | `backend/src/prompts/investigator.ts` | Modify | "for this investigation" → "for this case" (scripts/run history) |
| 13 | `backend/src/database/migrations/<ts>-AgentToolingScopes.ts` | Create | `data_room_files.anthropic_file_id`; `script_runs.case_id` (+ backfill) and nullable `investigation_id` |

### What changes (UX and DX)

**For the user (UX):**
- The agent can read the full 6.5 MB cryptoforensics report (and larger PDFs, up to Anthropic's 32 MB / 100-page processing limit) with figures and layout intact — not just a "too large" apology.
- Scripts run the moment a case is open — no need to first select or create an investigation just to process a Data Room file.

**For the developer (DX):**
- One uniform "oversized attachment" path (Files API) instead of a dead-end stub; the same uploader covers chat attachments and Data Room reads.
- Script runs reflect their real scope (case), removing a confusing guard that blocked case-level work.

## Engineering Decisions Made

- **Small PDFs unchanged.** PDFs within the base64 limit keep the existing inline-bytes path; only oversized PDFs go through the Files API (avoids an upload round-trip for the common case).
- **Cache `file_id` on the Data Room row.** Evidence files are immutable, so the uploaded `file_id` is cached and reused across turns/reads. On a stale id (Files API 404) we re-upload and overwrite. Chat attachments (no persistent row) upload per turn.
- **Read ceiling is type-aware.** PDF reads allowed up to 32 MB (Files API limit); other types keep the 5 MB ceiling so we don't download large files we can't use.
- **`investigation_id` → `SET NULL`, `case_id` → `CASCADE`.** Deleting an investigation preserves its script-run history under the case (custody); deleting the case removes them. Script runs are evidentiary, so we keep them when only the investigation goes away.
- **`list_script_runs` lists by case** (covers investigation-tagged and case-level runs). The existing per-investigation REST endpoint (`GET /investigations/:id/script-runs`, used by the frontend `ScriptsPanel`) is unchanged.

## Flagged nuances (non-blocking)

- **Case-level runs won't appear in the per-investigation `ScriptsPanel`** until a case-level runs view is added (out of scope). Runs executed with an investigation selected still appear there as today.
- **Dev migration backfill.** `synchronize:true` can't add a `NOT NULL case_id` to a non-empty `script_runs` table. On dev, run the migration's backfill SQL once (or truncate dev `script_runs`) — the migration file remains the prod source of truth. Generate via `./migrations.sh`; **do not apply** — leave for the user to run `./migrations.sh --prod --run`.

---

## Tasks

### Part A — Large PDFs via Files API

**A1. Provider (`anthropic.provider.ts`)**
- Add `'files-api-2025-04-14'` to the `betas` array in `streamChat` (currently `['compact-2026-01-12']`, line ~50) so `file_id` document blocks are accepted.
- Import `toFile` from `@anthropic-ai/sdk` and add:
  ```ts
  async uploadFile(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const file = await this.client.beta.files.upload(
      { file: await toFile(buffer, filename, { type: mimeType }) },
      { betas: ['files-api-2025-04-14'] },
    );
    return file.id;
  }
  ```
- Declare `uploadFile` on `LlmProvider` (`llm-provider.interface.ts`).

**A2. Attachment pipeline (`attachment-blocks.ts`)**
- Add `PDF_FILES_API_LIMIT` (~32 MB raw) constant.
- `buildAttachmentBlocks(attachments, uploader?)` gains an optional `uploader: (buf: Buffer, name: string, mime: string) => Promise<string>`.
- PDF branch (line ~110): when `att.data.length > PDF_B64_LIMIT`:
  - if `uploader` present and raw size ≤ `PDF_FILES_API_LIMIT`: `const fileId = await uploader(Buffer.from(att.data,'base64'), att.name, 'application/pdf')`; push `{ type:'document', source:{ type:'file', file_id: fileId }, title: att.name }`.
  - else: existing `sizeStub`.

**A3. Read path (`ai.service.ts` + `data-room.service.ts` + entity)**
- `data-room-file.entity.ts`: add `@Column({ name:'anthropic_file_id', type:'varchar', nullable:true }) anthropicFileId: string | null`.
- `getFileForAgentRead`: include `anthropicFileId` in the returned shape; add `setAnthropicFileId(caseId, fileId, id)` (scoped update).
- `executeReadDataRoomFile`: compute `maxBytes` from mime (PDF → 32 MB, else `MAX_AGENT_READ_BYTES`). Pass a caching uploader closure to `buildAttachmentBlocks` that returns `read.anthropicFileId` if set, else uploads via `this.llm.uploadFile(...)`, persists via `setAnthropicFileId`, and returns the id.
- Update the "too large" error copy to reflect the 32 MB / 100-page ceiling.

**A4. Tool copy (`tool-definitions.ts`)** — `read_data_room_file`: note large PDFs are read in full; only files beyond 32 MB / 100 pages need an excerpt.

### Part B — Case-scoped scripts

**B1. Entity (`script-run.entity.ts`)**
- `investigationId`: `@Column({ name:'investigation_id', type:'uuid', nullable:true })`; relation `onDelete:'SET NULL'`, nullable.
- Add `caseId`: `@Column({ name:'case_id', type:'uuid' })` + `@ManyToOne(() => CaseEntity, …, { onDelete:'CASCADE' })`.

**B2. Relations** — `investigation.entity.ts` scriptRuns stays (now nullable side); `case.entity.ts` add `@OneToMany(() => ScriptRunEntity, s => s.case) scriptRuns`.

**B3. Service (`script-execution.service.ts`)**
- `execute(caseId, investigationId: string | undefined, name, code, role)`: set `caseId`, set `investigationId` only when present.
- Add `listRunsForCase(caseId)` (last 20 by `created_at` DESC). Keep `listRuns(investigationId)` for the REST endpoint.

**B4. Dispatch (`ai.service.ts`)**
- `EXECUTE_SCRIPT_TOOL` (line ~694): guard `if (!caseId)` only; call `execute(caseId, investigationId, name, code, viewerRole)`.
- `LIST_SCRIPT_RUNS_TOOL` (line ~702): guard `if (!caseId)`; call `listRunsForCase(caseId)`.

**B5. Copy** — `tool-definitions.ts` (`execute_script`, `list_script_runs`) and `investigator.ts` (lines 16, 45): investigation → case.

### Part C — Migration

`./migrations.sh --prod --generate AgentToolingScopes`, then hand-edit to:
1. `ALTER TABLE "data_room_files" ADD "anthropic_file_id" varchar`.
2. `ALTER TABLE "script_runs" ADD "case_id" uuid`.
3. Backfill: `UPDATE "script_runs" sr SET "case_id" = i."case_id" FROM "investigations" i WHERE i."id" = sr."investigation_id"`.
4. `ALTER TABLE "script_runs" ALTER COLUMN "case_id" SET NOT NULL`.
5. `ALTER TABLE "script_runs" ALTER COLUMN "investigation_id" DROP NOT NULL`.
6. Drop old investigation FK; re-add as `ON DELETE SET NULL`. Add `case_id` FK → `cases(id) ON DELETE CASCADE`.

Leave the file for the user to apply.

### Part D — Tests
- `attachment-blocks`: oversized PDF + uploader → file-source block; without uploader → stub.
- `ai.service.spec`: `execute_script` succeeds with `caseId` and no `investigationId`; `read_data_room_file` oversized PDF returns `__agentReadBlocks` with a file-source document.
- `script-execution.service.spec`: `execute` persists `case_id`; `listRunsForCase` queries by case.
