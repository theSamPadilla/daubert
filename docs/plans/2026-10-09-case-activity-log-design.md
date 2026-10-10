# Case activity log: design

Date: 2026-10-09. Decisions: `docs/scratch/2026-10-09-case-activity-log-questions.md`.

## Why

AI chat messages are deleted after 30 days (`docs/chat-retention.md`). Tool calls lived only inside those messages, so the record of what the agent did on a case now disappears with them. Daubert's premise is a reviewable methodology, and the site's "Auditable" pillar claimed every tool call, query, and script is logged to the case. This log makes that true again, independent of chat retention.

## Decisions

1. **Coverage:** both the in-app chat agent and external agents working through MCP, in one log per case, tagged by source. `agent_audit_log` stays as the per-session security log.
2. **Entry content:** inputs plus outcome and a short summary. No full results: they live in the case already (graph, scripts with output, productions, data room) or are public chain data, and keeping them would undercut the 30-day chat retention.
3. **Visibility:** every case member (viewer and up) can read it on a new Activity tab. Append-only. Entries are deleted only with their case. Enforced in the database by triggers, decided 2026-10-09.

## Data model

`case_activity_log`

| Column | Type | Notes |
|---|---|---|
| `id`, `created_at` | uuid, timestamp | |
| `case_id` | uuid | FK cases, ON DELETE CASCADE; index `(case_id, created_at)` |
| `user_id` | uuid null | FK users, ON DELETE SET NULL. The human the agent acted for. |
| `source` | varchar | `chat` or `mcp` |
| `agent` | varchar null | Chat: model id. MCP: the session's client label (e.g. "Claude Desktop"). |
| `conversation_id` | uuid null | Plain column, no FK: chats are purged, the id still groups one session's actions. |
| `mcp_session_id` | uuid null | Plain column, matches `agent_audit_log.session_id`. |
| `action` | varchar(64) | Tool name |
| `input` | jsonb | Tool input, truncated past 16 KB with a marker |
| `status` | varchar(16) | `ok` or `error` |
| `summary` | jsonb null | Per-tool summary; `{ error }` on failure |
| `backfilled` | boolean | true for rows rebuilt from surviving chat messages |

No update or delete path in code.

## Write paths

- **Chat:** after each `AiService.executeTool` call, record action, input, ok/error and summary. Server-side `web_search` never reaches `executeTool`; record it from each model response's `server_tool_use` and `web_search_tool_result` blocks (query in, source titles and URLs as summary).
- **MCP:** every case-scoped MCP tool (those that call `caseAccess.assertRole(principal, caseId, ...)`) records after it runs, with `source = mcp`, the session's client label and session id.
- A failed log write is logged as `case_activity_log_write_failed` and does not fail the tool or the turn.

## Read path and UI

`GET /cases/:caseId/activity?before=<iso>&limit=<n>`, newest first, `RequireRole('viewer')`. The Activity tab in the case workspace lists time, who, source badge, action label, the key input (address, query, file, script name), and status; a row expands to the full input and summary. "Load more" pages back.

## Backfill

One-time: rebuild chat entries from `tool_use` blocks in the messages that survived the purge, with status from the matching `tool_result` (`is_error`), user from the conversation, model from `token_usage` where available, `backfilled = true`. MCP history is not backfilled: `agent_audit_log` has no case id and never recorded reads.

## Out of scope

Exporting the log, filtering beyond paging, and logging non-agent user actions.

## Follow-ups

- Terms section 5 and the Privacy Policy: the activity log is case data kept for the life of the case.
- Restore the "Auditable" pillar copy on the site once this ships.
