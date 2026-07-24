# Fullsend: investigation-graph-tool
Base branch: dev
Worktree: /Users/Sam/Work/Incite/dev/daubert/.worktrees/investigation-graph-tool   Branch: fullsend/investigation-graph-tool
Source: (conversation-derived) → docs/plans/2026-07-24-mcp-get-investigation.md

- [x] plan    → docs/plans/2026-07-24-mcp-get-investigation.md
- [x] execute → read-tools.ts (+ tests), docs; spec gate ✅, opus terminator: NO FIXES NEEDED; build exit 0, 94/94 MCP tests green
- [x] qa      → N/A (backend-only MCP tool, no browser surface); verified via unit tests + build
- [x] merge   → merged into dev (--no-ff). Merge SHA 5327011, feature commit a3c85f3. Worktree + branch removed.

## Decision log
- 2026-07-24: **Source** — no idea doc / plan existed. The feature was fully specified in the originating conversation (add an MCP `get_investigation` tool that returns a trace graph, since `get_case_data` explicitly excludes graph data). Authored the plan directly from that spec + codebase recon rather than stopping for `/ideate`. Anchored on the conversation + `docs/ai-system.md`.
- 2026-07-24: **Worktree dir** — no `.worktrees/`/`worktrees/` existed and no CLAUDE.md preference. Under fullsend autonomy, chose `.worktrees/` (project-local, hidden, already gitignored). Symlinked `backend/node_modules` from main (no dependency changes → full install wasteful).
- 2026-07-24: **Tool name & placement** — `get_investigation` in `read-tools.ts` (not `navigate-tools.ts`). navigate-tools' header invariant is "always textResult / never unbounded JSON"; a graph read must bypass the 8 KB cap, and read-tools already documents+hosts the cap-bypass pattern (the two data-room reads). read-tools also already reads investigation+trace data (`get_case_data`).
- 2026-07-24: **Parity, not new design** — the *native chat agent* already has `get_investigation` (`AiService.executeInvestigationTool`); only the MCP surface lacks it (the exact gap the prior session hit). So the MCP tool is a faithful port of the native contract: no `investigationId` → per-investigation summaries (name, notes, per-trace node/edge counts); with `investigationId` → full graph slimmed via `stripTraceForAgent` (visual metadata dropped, edges denormalized with addresses) then `filterTraceData(address, token)`. Reuse the pure utils from `ai/investigation-data.utils` (direct file import, no DI coupling) and the `investigationRepo` already injected in `ReadToolsService`. Cap-bypassing return (slimmed graphs exceed 8 KB). **No size guard** — mirror the native contract exactly; the description steers agents to narrow via `address`/`token` (MCP has no `execute_script`). caseId-scoped queries (`{ id, caseId }`) keep reads inside the authorized case.
- 2026-07-24: **QA** — backend-only MCP tool, no browser surface. `/qa` (browser exercise) is N/A, mirroring the sibling `mcp-data-room-read` fullsend which skipped QA for the same reason. Verification is unit tests + `npm run build` green.
