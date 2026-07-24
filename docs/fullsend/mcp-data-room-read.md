# Fullsend: mcp-data-room-read

Base branch: dev
Worktree: NONE — operator chose "build in current tree, leave uncommitted" (redlining feature is uncommitted on dev; worktree isolation would drop it). No merge step.
Source: docs/plans/2026-07-24-mcp-data-room-read.md

- [x] plan    → docs/plans/2026-07-24-mcp-data-room-read.md (authored directly; small, well-scoped)
- [ ] execute
- [ ] qa      → SKIPPED per operator ("No need to QA")
- [ ] merge   → SKIPPED per operator (leave uncommitted in working tree)

## Decision log
- 2026-07-24: No worktree / no merge — operator picked "build in current tree, leave uncommitted" (redlining is uncommitted on dev; isolation conflicts). Anchored on operator's explicit AskUserQuestion answer.
- 2026-07-24: Skip QA — operator said "No need to QA". Execute = plan → subagent implementers → sonnet spec gates → opus terminator, then stop (uncommitted).
- 2026-07-24: MCP read returns EXTRACTED TEXT for docx/pdf/xlsx/csv/txt and MCP image blocks for images — NOT Anthropic document blocks (external agent can't use our Files API). Anchored on MCP content model + the redlining need (agent needs document text). Engineering decision.
- 2026-07-24: read_data_room_file / list_data_room_files bypass the 8KB truncatedJson cap and return content directly (doc-appropriate 600k-char cap), else the cap would gut a document read. Engineering decision.
- 2026-07-24: Building the MCP read tool resolves BOTH redlining rough edges — the redlining.md skill's "use read_data_room_file" step now works on MCP too, so the skill fix shrinks to a one-line note that the workflow is identical on both surfaces.
