# Conversation Export Implementation Plan

**Goal:** a user can download any of their own AI conversations as a PDF or DOCX that includes what the agent did, and is warned before the 30-day purge deletes older messages.

## Summary
- **What & why:** Chat content is deleted after 30 days (`CHAT_RETENTION_DAYS`), and until now nothing could be taken out of a conversation. Users doing expert work need a record of what they asked, what the agent answered, and what it looked at to get there. This adds an export of a single conversation to PDF or DOCX, reusing the Puppeteer/DOCX pipeline that already renders productions, plus a "deleted in N days" warning in the chat history list.
- **Key product decisions:**
  - Only the conversation's owner can export it. This matches the existing access rule: conversations are private to their creator (`conversations.service.ts:42`).
  - The export contains the chat text **and** one line for each agent action (e.g. "Read data room file: Affidavit.pdf", "Updated production: Report v2"), with its time and an error marker if it failed. Raw tool payloads and raw ids are never included.
  - Formats: PDF and DOCX. One conversation at a time (no zip of a whole case).
  - The history list shows "Oldest messages deleted in N days" with an export link for any conversation whose oldest message is within 7 days of the purge. The purge removes old turns one at a time (`chat-retention.service.ts:23`), not the whole conversation, so the copy says "oldest messages", not "this conversation".
  - The "older messages were deleted" note in the export is driven by a stamp the purge writes (`conversations.history_truncated_at`), not a guess from dates.
- **Load-bearing architecture decisions:**
  - Rendering lives in the export module (`templates/conversation.ts`) next to the production templates, and goes through `ExportService.htmlToPdf` / `htmlToDocx`. No new rendering path.
  - Assistant markdown is converted to HTML on the backend with `marked`, then passed through the existing `sanitizeHtml`. The page has the same CSP meta as the other exports, so exported chat text can't run script inside Puppeteer.
  - Action lines come from a backend copy of the frontend's `activityFormat` labels. Targets (file and production names) are read from the persisted `tool_result` payloads, so no extra lookups are needed.
- **Opus-tagged tasks:** 2 and 4a (transcript builder: pairing tool_use/tool_result across rows, purged-history edge cases; retention stamp: purge SQL merge with the parallel data-room plan, migration backfill).

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task.

## Rules for every implementer

- Do NOT commit. Do NOT add a Co-Authored-By trailer anywhere. End each task with `git status`.
- Run only the spec files named in the task: `npx jest <path>` from `backend/`, `npx jest <path>` from `frontend/` (the frontend runner is Jest). Never `npm test`, never directory sweeps, never boot the app.
- Backend specs need Node 24: prefix with `PATH="$HOME/.nvm/versions/node/v24.8.0/bin:$PATH"`.
- Type-check with `npx tsc --noEmit` only when the task says so.
- No em dashes or en dashes in user-facing copy (export document text and UI strings included). No emojis; icons come from `react-icons/fa6`.
- Migrations go through `./migrations.sh` only. Never apply them; leave the file for review.
- The working tree has unrelated uncommitted changes (including the parallel data-room file memory plan). Never overwrite or revert them; merge with whatever is in the working tree.

## Atomized Changes

| Task | File | Action | Purpose |
|------|------|--------|---------|
| 1 | `contracts/paths/ai.yaml`, `contracts/schemas/*` | Modify | Contract for `POST /conversations/{id}/export` and `oldestMessageAt` on the conversation list |
| 1 | `contracts/openapi.yaml` | Modify | Register the `/conversations/{id}/export` path (paths are registered individually) |
| 1 | `backend/src/generated/api-types.ts`, `frontend/src/generated/api-types.ts` | Modify (generated) | Types from the contract |
| 2 | `backend/src/modules/ai/conversation-transcript.ts` (+ `.spec.ts`) | Create | Turns stored message rows into an ordered transcript of user text, assistant text and agent actions; exports `transcriptToText` for reuse by the long-conversation handoff plan |
| 2 | `backend/src/modules/ai/tool-labels.ts` | Create | Human-readable action labels (backend copy of the frontend `activityFormat` labels) |
| 2 | `backend/src/modules/ai/ai.service.ts` (+ `ai.service.spec.ts`) | Modify | `slimToolResult`'s `slimOne` keeps `error` when present, so a failed production write is no longer persisted as `{}` and can be shown as failed |
| 3 | `backend/src/modules/export/templates/conversation.ts` (+ `.spec.ts`) | Create | HTML document for an exported conversation, styled like the other exports |
| 3 | `backend/package.json` | Modify | Add `marked@^15` for assistant markdown |
| 4a | `backend/src/database/entities/conversation.entity.ts` | Modify | `historyTruncatedAt` column: records that the purge removed messages from this conversation |
| 4a | `backend/src/database/entities/message.entity.ts` | Modify | `IDX_messages_conversation_created` index on `(conversationId, createdAt)` so oldest-message lookups are not table scans |
| 4a | `backend/src/database/migrations/<ts>-ConversationHistoryTruncated.ts` | Create (generated) | Adds the column and index, backfills the stamp for already-purged conversations |
| 4a | `backend/src/modules/ai/retention/chat-retention.service.ts` (+ `.spec.ts`) | Modify | Purge stamps `history_truncated_at` on every conversation it deletes messages from |
| 4 | `backend/src/modules/ai/conversations.service.ts`, `conversations.controller.ts` | Modify | Owner-only export endpoint returning a PDF/DOCX download; list returns `oldestMessageAt` |
| 4 | `backend/src/modules/export/export.module.ts` | Modify | `exports: [ExportService]` so other modules can render |
| 4 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `ExportModule` for rendering |
| 4 | `backend/src/modules/ai/conversations.service.spec.ts` | Modify | Tests for ownership, format validation, oldest-message date |
| 5 | `frontend/src/lib/api-client.ts` | Modify | `exportConversation(id, format, title)` via `downloadFile`; `oldestMessageAt` on `Conversation` |
| 5 | `frontend/src/components/Workspace/AIChat.tsx` | Modify | Export button (PDF/DOCX menu) in the open chat header and in each history row; purge countdown in history rows |
| 5 | `frontend/src/components/Workspace/chatRetention.ts` (+ `chatRetention.test.ts`) | Create | `daysUntilPurge(oldestMessageAt)` helper shared by the list and its test |

---

## Task 1: Contract (sonnet)

In `contracts/paths/ai.yaml`:

- `POST /conversations/{id}/export`, body `{ format: 'pdf' | 'docx' }`. Response `200` with `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, binary. `403` if not the owner, `404` if missing, `400` for a bad format.
- Add `oldestMessageAt: string | null` (date-time) to the Conversation schema returned by `GET /cases/{caseId}/conversations`. The `create` endpoint returns `oldestMessageAt: null` (a new conversation has no messages).

Paths are registered individually in `contracts/openapi.yaml` (~lines 82-91): add `/conversations/{id}/export` there too.

Run `npm run gen` from the repo root. Check that the new export path and `oldestMessageAt` appear in both `api-types.ts` files (the tree has unrelated uncommitted changes, so do not expect the diff to be limited to these).

## Task 2: Transcript builder (opus)

`conversation-transcript.ts` exports pure functions:

```ts
type TranscriptEntry =
  | { kind: 'user'; at: string; text: string; attachments: string[] }   // attachment file names only
  | { kind: 'assistant'; at: string; markdown: string }
  | { kind: 'action'; at: string; label: string; target?: string; failed: boolean };
buildTranscript(rows: MessageEntity[]): TranscriptEntry[]
transcriptToText(entries: TranscriptEntry[]): string   // plain-text rendering, reused by the long-conversation handoff plan
```

Rules:

- User rows that hold only `tool_result` blocks are not user turns. Each `tool_result` pairs with its `tool_use` (by id, across rows) to give `failed`.
  - `tool_result` content is a JSON string: `JSON.parse` inside a try. Unparseable content (e.g. one ending in `...[truncated]`) counts as not failed.
  - Call `chatToolOutcome(toolUse.name, toolUse.input, parsed)` (3 args) from `case-activity/activity-summaries.ts`; import it, don't copy it. It flags `{ error }` results and `execute_script` with `status` of `error`/`timeout`.
  - A `tool_use` with no result at all counts as not failed.
- Assistant `tool_use` blocks become `action` entries: `label` comes from `tool-labels.ts`; `target` is the identifying input field (same `KEY_INPUT` table as the frontend's `activityFormat.ts`) with these exceptions. Raw ids are never printed.
  - `read_data_room_file`: `target` is `name` from the paired `tool_result` (present on both success and error paths), falling back to "a data room file".
  - `create_production` / `read_production` / `update_production`: `target` is `name` from the paired `tool_result`.
  - Label tools: `target` is `text` when present, otherwise no target.
- Server-side web search (`server_tool_use` name `web_search`) becomes an action with the query as `target`. Reuse `webSearchActivities(content)` from `case-activity/activity-summaries.ts:63`, called per assistant row, so failed searches are flagged. Explicitly skip every `server_tool_use` whose name is not `web_search`.
- Skip `thinking`, `redacted_thinking`, compaction blocks, `code_execution*` blocks, the synthetic `(file content follows)` / `(continuing)` assistant texts, and the `TOOL_RESULT_TERMINATOR` text. Keep STOP_NOTES text (e.g. "(Stopped before continuation...)") inside the assistant markdown; drop only `TOOL_RESULT_TERMINATOR`.
- User text cleanup:
  - Skip the `(attachment)` placeholder text that `persistUserMessage` stores (`ai.service.ts` ~390).
  - Strip the data-room plan's exported "Attached files saved to the data room" prefix constant from user text, and match `(file content follows)` via its exported `FILE_CONTENT_MARKER` constant. Both come from the data-room file memory plan; if it hasn't landed, fall back to the literal strings.
- Attachments:
  - `data_room_ref` blocks with origin `upload` add their `name` to `attachments`.
  - A user row consisting only of origin `read` refs produces no entry.
  - `document` blocks use their title/name. Image attachment blocks have no title or name: use "Image". Content is never included.
- A history whose oldest turns were purged starts mid-conversation. That's fine: no placeholder entry; the document header notes it (task 3).

`tool-labels.ts`: copy `LABELS` and `KEY_INPUT` from `frontend/src/components/Workspace/activityFormat.ts`. Add a comment in both files saying they must be kept in sync. Unknown tools fall back to the tool name with underscores turned into spaces.

`ai.service.ts`: in `slimToolResult`, make `slimOne` keep `error` when present. Today a failed production write is persisted as `{}`, so the export could not show it as failed. Add a spec case in `ai.service.spec.ts`: a failing production write result keeps its `error` after slimming.

Spec covers: plain chat; tool_use/tool_result pairing across rows; failed tool; unparseable (truncated) result is not failed; tool_use with no result; `read_data_room_file` target from result `name` and the "a data room file" fallback; production tools target from `name`; label tool `text` target and no-target case; web search (including a failed one) and a skipped non-web-search `server_tool_use`; skipped synthetic/terminator texts while STOP_NOTES text is kept; the `(attachment)` placeholder skipped; the data-room prefix and `FILE_CONTENT_MARKER` stripped; `data_room_ref` upload adds `name`; a user row of only read refs gives no entry; an image attachment shows as "Image"; a purged history starting with an assistant row; `transcriptToText`.

## Task 3: Conversation HTML template (sonnet)

`templates/conversation.ts`: `renderConversation({ title, caseName, ownerName, exportedAt, firstMessageAt, entries, truncatedByRetention })`, with the same structure as `templates/report.ts` (`BASE_STYLES`, `CSP_META`, `escapeHtml`, `sanitizeHtml`). Title, case name and owner name all go through `escapeHtml`.

- Header: conversation title (or "Untitled conversation"), case name, exported by, exported at, date range.
- If `truncatedByRetention`, show a line: "Messages older than 30 days were deleted under the chat retention policy and are not included."
- User turns: label "You", timestamp, escaped text, attachment names.
- Assistant turns: label "Assistant", `marked` to HTML, then `sanitizeHtml`.
- Action entries: compact muted lines grouped between turns, e.g. `Read data room file: Affidavit.pdf`, with "(failed)" when `failed`.
- Disclaimer text: "Generated by Daubert. AI output; verify before relying on it." (no em dashes). Rendering differs per format:
  - PDF: callers pass `htmlToPdf(html, { displayHeaderFooter: true, footerTemplate: <static disclaimer>, margin: { bottom: '20mm', ... }, timeout: 120_000 })`. `htmlToPdf` shows no footer unless `displayHeaderFooter` is set, and its default timeout is 30s, too short for long conversations. Export the static footer template string from this file.
  - DOCX: `htmlToDocx` hardcodes `footer: false`, so render the disclaimer as a closing paragraph at the end of the body HTML instead.

Add `marked@^15` to backend dependencies (the last major that ships CJS; 16+ is ESM-only and breaks ts-jest and the CommonJS build).

Spec (snapshot like `report.spec.ts`): a sample transcript renders; a `<script>` in assistant markdown is stripped; user text is escaped; title, case name and owner name containing HTML are escaped; the retention line appears only when flagged; the closing disclaimer paragraph is present in the body.

## Task 4a: Retention stamp (opus)

Replaces any date-based guess about whether history was purged with a stamp written by the purge itself.

- `ConversationEntity`: add `historyTruncatedAt` (`history_truncated_at timestamptz null`).
- `MessageEntity`: add `@Index('IDX_messages_conversation_created', ['conversationId', 'createdAt'])`. No index on `messages.conversation_id` exists today, and the oldest-message queries and per-conversation loads need one.
- `chat-retention.service.ts` (`PURGE_MESSAGES`, lines ~36-44): make the `deleted` CTE `RETURNING m.conversation_id`, and add an `UPDATE conversations SET history_truncated_at = NOW()` for those ids. Note: the parallel data-room file memory plan edits the same `PURGE_MESSAGES` SQL (it excludes origin `'read'` `data_room_ref` rows from `keep`). Merge with whatever is in the working tree; do not overwrite it.
- Migration: `./migrations.sh --prod --generate ConversationHistoryTruncated` (never apply it). If the generated file picks up other pending entity changes from the parallel data-room plan (`data_room_file_notes` etc.), trim it to only this plan's column and index. Add a data backfill to `up()`: set `history_truncated_at = NOW()` where the earliest `agent_runs.created_at` for the conversation is more than 1 minute before its first remaining message (`agent_runs` rows are not purged, so this detects conversations already purged before the stamp existed). `down()` drops the index and column.
- Extend `chat-retention.service.spec.ts`: the purge stamps conversations it removed messages from and leaves untouched conversations unstamped; the SQL still honours the data-room plan's `keep` exclusion if it is present.

## Task 4: Export endpoint + `oldestMessageAt` (sonnet)

- `ConversationsService.export(id, userId, format)`: `findOne` (enforces the owner, so a non-owner gets 403), loads messages ordered by `createdAt`, `buildTranscript`, `renderConversation`, then `ExportService.htmlToPdf` (with the options from task 3) or `htmlToDocx`. `truncatedByRetention = conv.historyTruncatedAt != null`. No data room name lookup is needed: names come from the persisted tool results.
- Controller: `@Post(':id/export')` on `ConversationsController`, validating `format` with a DTO. Stream the buffer with `Content-Disposition: attachment; filename="<slug>.<ext>"`.
  - Slug: the title lowercased, `[^a-z0-9]+` replaced with `-`, trimmed of leading and trailing `-`, max 60 chars; fallback `conversation-<yyyy-mm-dd>` when empty. Never interpolate raw input into `Content-Disposition`.
  - Rate-limit like the other export endpoints if they have a guard; otherwise none.
- `findAllForUserInCase`: add `oldestMessageAt` with a single `MIN(created_at)` grouped subquery (served by the task 4a index), never N+1. `create` returns `oldestMessageAt: null`.
- Wiring: add `exports: [ExportService]` to `ExportModule` (`backend/src/modules/export/export.module.ts`); `AiModule` imports `ExportModule`. No circularity, no `forwardRef`.

Spec additions to `conversations.service.spec.ts`: a non-owner export is rejected; `pdf` calls `htmlToPdf` (with footer options and the long timeout), `docx` calls `htmlToDocx` (mock `ExportService`); `truncatedByRetention` follows `historyTruncatedAt`; the filename slug (special characters, long title, empty title fallback); `oldestMessageAt` is correct, and null for an empty conversation.

## Task 5: Frontend (sonnet)

- `api-client.ts`: `exportConversation(id, format, title)` using `downloadFile` (same pattern as `exportProduction`); add `oldestMessageAt` to `Conversation`.
- `chatRetention.ts`: `daysUntilPurge(oldestMessageAt, now = new Date())` returns whole days until `oldestMessageAt + 30 days`, or null. Keep the 30 as one constant with a comment pointing at `CHAT_RETENTION_DAYS`.
- `AIChat.tsx`:
  - Open conversation header: an export icon button (`FaFileArrowDown`) opening a two-item menu, "Export as PDF" and "Export as DOCX". Disabled while a run is streaming or when there are no messages. Show a spinner while downloading and an inline error on failure.
  - History list rows: the same export menu next to the existing trash button.
  - History list rows with `daysUntilPurge <= 7`: muted text "Oldest messages deleted in N days" (or "today" for 0), which opens the export menu when clicked.
- Test file `chatRetention.test.ts` for `daysUntilPurge` (boundaries: 8, 7, 0, null). Run with `npx jest src/components/Workspace/chatRetention.test.ts` from `frontend/`.

Run `npx tsc --noEmit` in `frontend/`.

---

## Out of scope

- Exporting all of a case's conversations at once (zip).
- Exporting other members' conversations, or admin export.
- Recording exports in the case activity log.
- Markdown format.
