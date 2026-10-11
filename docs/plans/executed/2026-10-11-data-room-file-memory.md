# Data Room File Memory Implementation Plan

**Goal:** the chat agent never drafts findings about a document it hasn't read, and once it reads a file it can come back to it, both later in the conversation and in other conversations on the case.

## Summary
- **What & why:** A customer (Amanda Wick) found the agent had drafted findings from the data-room manifest (file names and sizes) without reading the files. When she made it read them 2-3 at a time, the new findings contradicted the old ones. Reads were also being lost: file content stayed in context only for the rest of the user message that read it, and the 10-iteration loop often ran out before the agent wrote anything up. This plan keeps reads in the conversation, saves per-file notes on the case, marks files with no notes as unreviewed, and forbids findings on unread files.
- **Key product decisions:**
  - On every read, the agent writes structured notes for that file. Notes belong to the **case, not the conversation**: one current set per file that every case member and conversation can use. Notes are case work product like productions, so the 30-day chat purge does not touch them.
  - **Viewers' agents may record file notes.** `record_file_notes` is registered in both `AGENT_TOOLS` and `READ_ONLY_AGENT_TOOLS`, alongside `get_file_notes`. Notes are the agent's reading records, not edits to the case, so a viewer's agent writing them does not change anything a viewer could not already see. The read-only-set assertion in `tools/index.spec.ts` explicitly allows `record_file_notes` as the one write it permits.
  - **One rule for every file, whether it was read from the data room or dropped into chat.** The agent writes notes as soon as it sees a file. The full file stays in the conversation for the next **10 user messages**, then it's pruned to a stub with the file name, when it was read, and a short version of its notes ("re-read for exact text"). Re-reading restarts the window. Server-side compaction (every model except Haiku 4.5) is the backstop beyond that.
  - **Files dropped into chat are saved to the case data room** in a "Chat uploads" folder, attributed to the uploader. From then on they are ordinary data-room files: a pointer in the conversation, case-level notes, and re-readable by any conversation on the case. Any case member who can chat can upload this way, including viewers, since their agent already reads files the same way.
  - Conversations that already hold inline base64 files (like Klimenka) get the same 10-message window applied when history loads, so they get lighter without rewriting the DB.
  - The manifest shows each file's review status (`hasNotes`). The agent must label any finding that isn't based on a read file as "not reviewed".
- **Load-bearing architecture decisions:**
  - The DB stores a `data_room_ref` pointer block, never file bytes. It's swapped for real document blocks only when history is loaded, so messages stay small. Rehydration is budgeted (bytes and PDF pages) and does not write access-log rows.
  - Only pointers within the 10-message window and after the latest compaction block are reloaded, and only the most recent pointer per file. This avoids wasted downloads and duplicate copies of the same file. A byte/page budget stays as a backstop for many large files inside one window.
  - Pointers carry `origin: 'read' | 'upload'`. Read pointers sit in their own rows; upload pointers sit in the user's own message row. The purge and the UI use `origin` to tell the two apart.
  - When the loop runs out of iterations or run time, or the repeat-tool guard fires, it makes one last call with the same tools but `tool_choice: { type: 'none' }` so the agent writes up what it read. Reads can't end silently any more, and the cache and tool_use history stay valid.
- **Opus-tagged tasks:** 4 (pointer persistence + rehydration + 10-message window), 5 (compaction), 6 (forced write-up + run deadline), 8 (chat uploads into the data room).

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task.

## Rules for every implementer

- Do NOT commit. Do NOT add a Co-Authored-By trailer anywhere. End each task with `git status`.
- Run only the spec files named in the task: `npx jest <path>` from `backend/`. Never `npm test`, never directory sweeps, never boot the app.
- Backend specs need Node 24: prefix with `PATH="$HOME/.nvm/versions/node/v24.8.0/bin:$PATH"`.
- Type-check with `npx tsc --noEmit` in `backend/` only when the task says so.
- Generate migrations only through `./migrations.sh --prod --generate <Name>`. Never apply them.
- No em dashes in user-facing copy (tool descriptions and prompt text the agent repeats count as user-facing).

## Atomized Changes

| Task | File | Action | Purpose |
|------|------|--------|---------|
| 1 | `backend/src/database/entities/data-room-file-note.entity.ts` | Create | Per-file case notes table (`data_room_file_notes`), one current row per file |
| 1 | `backend/src/database/entities/index.ts` | Modify | Register the entity |
| 1 | `backend/src/modules/data-room/data-room.module.ts` | Modify | Add `DataRoomFileNoteEntity` to `TypeOrmModule.forFeature` so the service can inject its repository |
| 1 | `backend/src/database/entities/entities.spec.ts` (if it exists) | Modify | Assert the `data_room_file_notes` table name |
| 1 | `backend/src/database/migrations/<ts>-DataRoomFileNotes.ts` | Create (generated) | Prod migration for the table |
| 1 | `docs/data-model.md` | Modify | Document the table |
| 2 | `backend/src/modules/data-room/data-room.service.ts` | Modify | `upsertFileNotes`, `getFileNotes`; manifest entries carry `hasNotes` + `notesUpdatedAt` |
| 2 | `backend/src/modules/data-room/data-room.service.spec.ts` | Modify | Tests for notes and the manifest flag |
| 3 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | New `record_file_notes` and `get_file_notes` tools; `read_data_room_file` description updated |
| 3 | `backend/src/modules/ai/tools/index.ts`, `backend/src/modules/ai/tools/index.spec.ts` | Modify | Register both tools in `AGENT_TOOLS` and `READ_ONLY_AGENT_TOOLS`; spec allows `record_file_notes` as the one write in the read-only set |
| 3 | `backend/src/modules/ai/ai.service.ts` | Modify | Dispatch the new tools; reads return any existing notes; manifest says "metadata only" |
| 3 | `backend/src/modules/case-activity/activity-summaries.ts` | Modify (optional) | Custom activity summaries for note writes; chat tool activity flows through `chatToolOutcome` |
| 4 | `backend/src/modules/ai/ai.service.ts` | Modify | Reads saved as `data_room_ref` pointers and reloaded as full files on later messages |
| 4 | `backend/src/modules/ai/data-room-rehydrate.ts` (+ `.spec.ts`) | Create | Pure helpers: find pointers after the last compaction, dedupe by file, apply the byte/page budget, swap in blocks |
| 4 | `backend/src/modules/data-room/data-room.service.ts` (+ `.spec.ts`) | Modify | `getFileForRehydrate`: same tenancy and size gate as `getFileForAgentRead`, no `agent_read` access-log row |
| 4 | `backend/src/modules/ai/conversations/conversations.service.ts` (message-list path) | Modify | Filter the exported `(file content follows)` marker row from `getMessages` responses |
| 4 | `backend/src/modules/ai/retention/chat-retention.service.ts` (+ `.spec.ts`) | Modify | `PURGE_MESSAGES` stops treating `data_room_ref` rows as user prompts to keep |
| 5 | `backend/src/modules/ai/providers/anthropic.provider.ts` (+ spec) | Modify | Turn on server-side context compaction via `context_management`; gate by model |
| 5 | `backend/src/modules/ai/ai.service.ts` | Modify | `MODEL_SHAPES.compaction`; trim history to the last compaction block; `recordUsage` sums `usage.iterations`; fix misattributed "programmatic tool calling" comments |
| 5 | `backend/src/modules/ai/runs/run-abort.ts` | Modify | Fix the misattributed comment (~22) |
| 6 | `backend/src/modules/ai/ai.service.ts` | Modify | `MAX_ITERATIONS` 10 to 30 (10 stays for Haiku 4.5); `deadlineAt` in `RunTurnParams`; forced write-up with `tool_choice: none` |
| 6 | `backend/src/modules/ai/providers/anthropic.provider.ts` (+ spec) | Modify | Optional `toolChoice` param on `streamChat`, forwarded to the API |
| 6 | `backend/src/modules/ai/runs/agent-run-executor.service.ts` (+ spec) | Modify | Pass `deadlineAt` (start + `RUN_TIME_LIMIT_MS`) into `runTurn` |
| 7 | `backend/src/prompts/investigator.ts`, `backend/src/skills/daubert-overview.md`, `backend/src/skills/redlining.md` | Modify | No findings on unread files; read up to 3 files, then record notes and report; notes for uploads before answering |
| 8 | `backend/src/modules/ai/ai.service.ts` (`persistUserMessage`) | Modify | Chat attachments saved to the data room and stored as `data_room_ref` (`origin: 'upload'`) instead of inline base64 |
| 8 | `backend/src/modules/data-room/data-room.service.ts` (+ spec) | Modify | `saveChatUpload(caseId, userId, name, mime, buffer)`: find-or-create the "Chat uploads" folder, store the file |
| 8 | `frontend/src/components/Workspace/AIChat.tsx` | Modify | Attachment chips render from upload pointers; note that dropped files are saved to the data room |

---

## Task 1: `data_room_file_notes` entity + migration (sonnet)

Create `DataRoomFileNote`, using `data-room-file.entity.ts` as the style reference:

- `id` uuid PK
- `caseId` uuid, FK to `cases` with `ON DELETE CASCADE`, indexed
- `fileId` uuid, FK to `data_room_files` with `ON DELETE CASCADE`, **unique** (one current row per file)
- `notes` jsonb. Shape (TS type `FileNotes`, exported from the entity file):
  ```ts
  { summary: string; keyFacts: string[]; parties: string[]; dates: { date: string; event: string }[];
    quotes: { text: string; page?: number }[]; relevance: string; coverage: 'full' | 'partial'; coverageNote?: string }
  ```
  `coverage: 'partial'` means the read got only part of the file (excerpt, page cap). `coverageNote` says which part.
- `updatedByUserId` uuid nullable (FK users, `ON DELETE SET NULL`), `conversationId` uuid nullable with no FK (conversations get purged), `model` varchar nullable
- `createdAt`, `updatedAt`

Register it in `entities/index.ts`. Add `DataRoomFileNoteEntity` to the `TypeOrmModule.forFeature([...])` list in `backend/src/modules/data-room/data-room.module.ts` (~line 16); without it the service in task 2 cannot inject the repository. Add a section to `docs/data-model.md`. If `backend/src/database/entities/entities.spec.ts` exists, add a table-name assertion for `data_room_file_notes` and run it with `npx jest backend/src/database/entities/entities.spec.ts` (from `backend/`, the path relative to that dir). Generate the migration with `./migrations.sh --prod --generate DataRoomFileNotes` and check that it contains only this table. Run `npx tsc --noEmit`.

## Task 2: Notes service + manifest flag (sonnet)

In `DataRoomService`:

- `upsertFileNotes(caseId, fileId, notes, { userId, conversationId, model })`: check that the file belongs to the case (`NotFoundException` otherwise), then upsert on `fileId`.
- `getFileNotes(caseId, fileIds: string[])`: returns `{ fileId, name, notes, updatedAt }[]` only for files in this case, capped at 50 ids.
- `getManifest`: left join notes, and add `hasNotes: boolean` and `notesUpdatedAt: string | null` to every entry. This also covers the MCP `list_data_room_files` tool, since it uses the same method.

Spec: extend `data-room.service.spec.ts` to cover upsert insert/update, a cross-case fileId rejected, and the manifest flag true/false.

## Task 3: Agent tools for notes (sonnet)

`tool-definitions.ts`:

- `record_file_notes({ fileId, notes })`, with the schema mirroring `FileNotes`. Description: call it right after reading a file and before reading the next one; it replaces the file's current notes, so merge in anything from the existing notes you want to keep.
- `get_file_notes({ fileIds })`. Description: get saved notes for files that have already been reviewed without re-reading them. Re-read the file only when you need exact text.
- `read_data_room_file` description: the content stays in the conversation (task 4); after reading, record notes before moving on.

`backend/src/modules/ai/tools/index.ts`:

- Register **both** `record_file_notes` and `get_file_notes` in `AGENT_TOOLS` and in `READ_ONLY_AGENT_TOOLS`. Product decision: viewers' agents may record file notes, because notes are the agent's reading records, not case edits.
- `index.spec.ts`: update the expectations so both tools appear in both sets. The existing read-only-set assertion (no write tools) must explicitly allow `record_file_notes` as the one write it permits, with a comment saying why: notes are agent reading records, not case edits.

`ai.service.ts`:

- Dispatch both tools in `executeTool`. Both are available to any case member whose agent can run, including viewers.
- `executeReadDataRoomFile`: the summary now includes `existingNotes` (or null) and a new note: "File content follows and stays in this conversation. Record notes with record_file_notes before reading another file."
- `executeCaseDataTool`: add `note: 'Metadata only. A file with hasNotes=false has NOT been reviewed; do not describe its contents.'` to `dataRoom`.
- Activity log: chat tool activity flows through `chatToolOutcome` in `backend/src/modules/case-activity/activity-summaries.ts`, which is the only file to touch if custom summaries are wanted (`record_file_notes`: file name + coverage; `get_file_notes`: file count). Do NOT touch `mcp/tools/case-activity-recorder.ts`; it only covers MCP tools.

Spec: the `ai.service` spec already covers tool dispatch; add cases for both tools (including a viewer dispatching `record_file_notes`) and for `existingNotes` in the read summary.

## Task 4: Persist reads as pointers, rehydrate on load (opus)

Today the file blocks are pushed into in-memory `messages` only (`ai.service.ts` near the `extraUserBlocks` push). Change that:

1. **Persist.** The loop lives in `runTurn` (`ai.service.ts` ~417), not `streamChat`. For each successful read, save three rows as **three separate save calls** so they get distinct `created_at` values (see the comment at ~745-749): the `tool_result` row, then the synthetic assistant row `(file content follows)`, then a user row whose content is `[{ type: 'data_room_ref', origin: 'read', fileId, name, mediaType }]` (one block per file read in that iteration). After saving the ref row, set `lastPersistedWasToolResult = false`, otherwise the `finally` block (~797) appends a terminator. Export the `(file content follows)` text as a constant (e.g. `FILE_CONTENT_MARKER`) so other modules can match it.
2. **Rehydrate** (new pure module `data-room-rehydrate.ts`):
   - `collectRefs(messages, { windowPrompts: 10, budget })`: finds `data_room_ref` blocks (both origins) that come **after the last compaction block**. The compaction block shape is `{ type: 'compaction', content: '<summary>' }` (confirmed API shape; the spec must build its fixtures from this literal and must not depend on task 5). Keeps only the last ref for each `fileId`, and swaps earlier ones for a text block `[file <name> re-read later in this conversation]`.
   - **10-message window (`FILE_WINDOW_PROMPTS = 10`).** Count user *prompts* backwards from the newest: a prompt is a user row that isn't only `tool_result` blocks or only `origin: 'read'` refs. A ref is in the window when it sits at or after the 10th most recent prompt. Refs outside the window become a stub: `[file <name> (fileId <id>) was read <N> messages ago; full content pruned to keep this conversation light. Notes: <notes.summary, clipped to ~600 chars, or "none recorded">. Call get_file_notes for full notes or read_data_room_file for exact text.]`. Load the notes for all stubbed files with one `getFileNotes` call.
   - **Legacy inline files.** Rows saved before this change hold inline base64 `document`/`image` blocks in user messages (Klimenka holds 4.7 MB of them). Apply the same window to them: inline document/image blocks outside the window become `[attached file <title or "unnamed"> was shared <N> messages ago; its content is no longer loaded.]`. This only changes the in-memory request; it never rewrites stored rows.
   - **Budget (backstop).** The request limit is 32 MB, PDFs cap at 600 pages per request (100 for 200K-context models such as Haiku 4.5). Inside the window, `collectRefs` still applies a budget of max total bytes and max PDF pages. Refs beyond the budget, oldest first, get the same stub as out-of-window refs.
   - `swapRefs(messages, blocksByFileId)`: replaces each remaining ref with its document/image blocks. A file that no longer exists or can no longer be read becomes the text `[file <name> no longer available]`.
   - In `runTurn`, after loading history and before sanitizing, call `collectRefs`, then load each remaining file in parallel with a small concurrency cap (e.g. 4) through the new `DataRoomService.getFileForRehydrate` + `buildAttachmentBlocks`, reusing the cached `anthropicFileId` so large PDFs aren't uploaded again, then `swapRefs`. Use the **conversation's case** (`resolvedCaseId`, ~428), not the request's `caseId`.
   - `DataRoomService.getFileForRehydrate(caseId, fileId, ...)`: same tenancy check and size gate as `getFileForAgentRead`, but it must NOT write a row to `data_room_access_log` (`getFileForAgentRead` writes an `agent_read` row, ~line 366 of `data-room.service.ts`; rehydrating on every message would flood the log with false reads). Share the common code in a private helper.
3. **No raw refs leak.** Make sure nothing that sends to the API, and no frontend message renderer, ever sees a raw `data_room_ref` block. Rows holding only `data_room_ref` blocks are already hidden in the UI. The persisted `(file content follows)` synthetic assistant row would render as a chat bubble (`AIChat.tsx` 57-67 renders text rows), so filter rows whose text equals `FILE_CONTENT_MARKER` in the `conversations.service` `getMessages` response (or, if that is awkward, in `AIChat.tsx`). The tool_start chip already shows the read.
4. **Purge.** There is no content scrubbing in the purge. Instead, `PURGE_MESSAGES` in `backend/src/modules/ai/retention/chat-retention.service.ts` (~28-34) treats any user row that is not a `tool_result` as a prompt to keep. Exclude read-pointer rows from `keep` with `p.content @> '[{"type":"data_room_ref","origin":"read"}]'::jsonb`. Upload pointers (`origin: 'upload'`) live in the user's own message row, which IS a prompt and must stay keepable, even when the message has no text (attachment-only). Extend `chat-retention.service.spec.ts`: a read-pointer row is purged while a normal prompt row is kept, and an upload-only prompt row is kept as a prompt.

Spec: `data-room-rehydrate.spec.ts` covers: a ref 9 prompts back is loaded and one 11 prompts back is stubbed with its notes summary; tool_result-only and read-pointer rows don't count as prompts; re-reading restarts the window (only the newest ref counts); legacy inline document blocks outside the window are stubbed and inside are kept; refs before a compaction block are ignored; duplicate refs are deduped to the last one; a missing file becomes a note; a mixed history keeps strict role alternation after the swap; refs over the byte budget and over the PDF page budget become the "no longer loaded" text, oldest first. `data-room.service.spec.ts`: `getFileForRehydrate` enforces tenancy and the size gate and writes no access-log row. Extend the `ai.service` spec: a read in run 1 is present as a document block in run 2's request, `lastPersistedWasToolResult` ends false (no terminator appended), and the `getMessages` response omits the marker row. Run `chat-retention.service.spec.ts`, `data-room.service.spec.ts`, `data-room-rehydrate.spec.ts`, and the touched `ai.service` and `conversations.service` specs.

## Task 5: Server-side context compaction (opus)

Confirmed API facts (no need to look anything up):

- `compact-2026-01-12` IS the compaction beta. It is currently OFF: the header is sent but no `context_management` is in the request.
- Request: `context_management: { edits: [{ type: 'compact_20260112', trigger: { type: 'input_tokens', value: N } }] }`, with N >= 50000 and a default of 150000.
- Response: the assistant content begins with `{ type: 'compaction', content: '<summary>' }`, streamed as a single `compaction_delta`. The API ignores all blocks before a compaction block.
- Not supported on `claude-haiku-4-5`. Gate it through `MODEL_SHAPES` in `ai.service.ts`: add a `compaction` field that is `null` for Haiku 4.5 and a trigger value for the other models (pick it comfortably below the context window and note the choice in a code comment).

Work:

- Turn compaction on in `AnthropicProvider.streamChat` when the model shape has a `compaction` value; otherwise send no `context_management`.
- The provider only strips thinking blocks, so compaction blocks already persist in the assistant content. Spec: assert a compaction block in `response.content` is persisted unchanged.
- On history load, and after any response that contains a compaction block, trim `messages` to start at the assistant message holding the last compaction block (the API ignores everything before it anyway, and this keeps task 4's "after the last compaction" rule and request size honest).
- Do NOT add a fifth cache breakpoint. The existing old-history breakpoint covers the post-compaction history.
- Check that `sanitizeToolPairs` / `mergeConsecutiveRoles` handle a history that begins with an assistant message holding a compaction block (role alternation: the trimmed history may start with an assistant turn; handle it the way the API requires).
- `recordUsage` (`ai.service.ts` ~1302-1326) must sum `usage.iterations` so the tokens spent on compaction are metered, not just the top-level usage.
- Fix the misattributed "programmatic tool calling" comments for `compact-2026-01-12`: `ai.service.ts` lines ~85, 207, 504, 513, 687, 781; `anthropic.provider.ts` ~70; `runs/run-abort.ts` ~22.

Spec: provider spec asserts the request carries the `context_management` config for a non-Haiku model and omits it for `claude-haiku-4-5`; the compaction-block-persisted-unchanged assertion above; an `ai.service` spec with a stubbed compaction block in history checks the history is trimmed to it, it is replayed, and the earlier refs aren't rehydrated; `recordUsage` sums `iterations`.

## Task 6: Iteration budget + forced write-up (opus)

The run deadline lives only in `backend/src/modules/ai/runs/agent-run-executor.service.ts` (`RUN_TIME_LIMIT_MS` = 25 min).

- `MAX_ITERATIONS` per model: 10 for `claude-haiku-4-5` (unchanged), 30 otherwise.
- Add `deadlineAt: number` to `RunTurnParams` (`ai.service.ts` ~318-328). The executor sets it (run start + `RUN_TIME_LIMIT_MS`) when it calls `runTurn`.
- Trigger the forced write-up call when any of these holds: `i === MAX_ITERATIONS - 1`; `Date.now() + estimated round time > deadlineAt` (estimate from the longest round so far, with a sane floor); or the repeat-tool guard (`ai.service.ts` ~664-677) fires.
- The forced call must NOT drop tools. The API rejects a history containing `tool_use` / `tool_result` blocks when `tools` is empty, and dropping tools busts the prompt cache. Send the same `tools` with `tool_choice: { type: 'none' }`. Add an optional `toolChoice` param to `AnthropicProvider.streamChat` (`providers/anthropic.provider.ts`) and forward it to the request.
- Append an extra trailing user text block: "You are out of tool calls for this message. Report your findings on every file you read in this message now. Say which files still need notes." Persist and stream it like any final answer, so the loop ends on an assistant text, not a dangling tool_result.

Spec: an `ai.service` spec where the stub always returns tool_use checks that the last request carries the same tools plus `tool_choice: { type: 'none' }` and the persisted tail is assistant text; one case each for the deadline trigger and the repeat-tool trigger; Haiku 4.5 keeps 10 iterations. Provider spec: `toolChoice` is forwarded when set and omitted otherwise. Executor spec: `runTurn` receives `deadlineAt` derived from `RUN_TIME_LIMIT_MS`.

## Task 7: Prompt rules (sonnet)

In `prompts/investigator.ts`, data-room section:

- Never state, summarize or infer what a document says unless you read it with `read_data_room_file` or have its saved notes from `get_file_notes`. The manifest is metadata only.
- If asked for findings across files that haven't all been reviewed, list the unreviewed files explicitly as "not reviewed" and don't characterize them.
- Read no more than 3 files before calling `record_file_notes` for each and reporting what you found.
- Prefer `get_file_notes` over re-reading; re-read only for exact quotes or pages the notes don't cover.
- Files the user attaches are saved to the data room. When a message has attachments, record notes for each with `record_file_notes` before answering.
- A file's full content stays in the conversation for 10 user messages, then only its notes remain. Never quote or cite page-level detail from a pruned file without re-reading it.

Apply the same rules in `skills/daubert-overview.md` and `skills/redlining.md` wherever they mention `read_data_room_file`. Update the `read_data_room_file` line in the prompt's tool list ("for the current turn only" is no longer true).

No spec; there is no investigator prompt snapshot spec.

## Task 8: Chat uploads go into the data room (opus)

Depends on tasks 2-4. Today `persistUserMessage` (`ai.service.ts` ~381) runs `buildAttachmentBlocks` and stores the base64 blocks in the user row, which is then re-sent on every message forever.

- `DataRoomService.saveChatUpload(caseId, userId, name, mimeType, buffer)`: find-or-create a root folder named "Chat uploads" for the case (one per case, created on first use), store the file through the existing upload path (`uploadFromStream` or its internals) so storage, size limits and the access log behave like any upload, and return the file row. Any case member whose agent can chat may do this, viewers included (product decision; same reasoning as viewers recording notes).
- `persistUserMessage`: for each attachment, `saveChatUpload` and then store `{ type: 'data_room_ref', origin: 'upload', fileId, name, mediaType }` in the user row instead of inline blocks. Also add one text block to the stored row: `Attached files saved to the data room: <name> (fileId <id>), ... Record notes for each with record_file_notes before answering.` If saving a file fails, fail the message with a clear error. Never fall back to inline base64.
- The conversation's case is required for this. If the conversation has no case (check whether that's possible today), keep the current inline behaviour for that case only and say so in a code comment.
- Rehydration (task 4) already loads upload refs inside the 10-message window. The upload's first run sees the full file because it's in the newest prompt.
- Frontend `AIChat.tsx`: `MessageAttachments` / `AttachmentChip` currently read inline blocks. Render chips from `data_room_ref` blocks with `origin: 'upload'` as well (name + icon from `mediaType`), keeping support for legacy inline blocks. Under the composer's attachment area, add muted text: "Attached files are saved to this case's data room."
- Hide the stored "Attached files saved to the data room..." text block from the user's bubble (it's for the agent): export it as a prefix constant and strip it in the same place task 4 filters the marker row.

Spec: `data-room.service.spec.ts`: `saveChatUpload` creates the folder once and reuses it; the file is in the case. `ai.service.spec.ts`: a message with an attachment stores a ref row with no base64, and the next request contains the document block; a save failure fails the message. Run `npx tsc --noEmit` in `frontend/`.

---

## Out of scope (follow-ups)

- **Document review job:** a background run that reads all files in a case and writes notes for each, so a 240-document data room doesn't need hand-holding in chat. The notes table here is designed to be its output.
- `record_file_notes` / `get_file_notes` as MCP tools for external agents.
- Showing notes and review status in the data-room UI.
