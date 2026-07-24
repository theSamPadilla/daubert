# MCP `get_investigation` Tool — Implementation Plan

**Goal:** Give the MCP (bring-your-own-agent) surface a `get_investigation` tool that returns an investigation's **graph data** (nodes, edges, groups, bundles) — reaching parity with the native chat agent, which already has this tool. Today an MCP agent can see *that* investigations exist and their trace/node/edge **counts** (`get_case_data`, `list_investigations`) but has **no way to read the actual graph** — so it cannot verify a claim by inspecting nodes/edges, the exact gap that surfaced when a connected agent tried to check a chronology against the underlying trace.

## Summary

- **What & why:** The native chat agent (`AiService.executeInvestigationTool`) exposes `get_investigation`: without an id it returns per-investigation summaries; with an id it returns the full graph, slimmed for an LLM (visual metadata stripped, edges denormalized with from/to addresses), with optional `address`/`token` filters. The MCP surface never got this tool — `get_case_data`'s own description says it does *not* return graph data. This plan ports the native tool to MCP with identical semantics.
- **Key product decisions (locked):**
  - **Faithful parity, not a redesign.** Same name (`get_investigation`), same two modes (summaries vs. full), same `address`/`token` filters, same slimmed shape as the native tool — an agent that knows the chat tool uses the MCP tool unchanged.
  - **No `investigationId` → summaries** of every investigation in the case (`{ id, name, notes, traces: [{ id, name, nodeCount, edgeCount }] }`). **With `investigationId` → full slimmed graph** per trace.
  - **`viewer`-gated**, `caseId`-scoped (an `investigationId` that isn't under the given `caseId` reads as not-found) — same isolation model as every other case-scoped MCP tool.
- **Load-bearing architecture decisions:**
  - **Reuse the pure slimming utils** `stripTraceForAgent` + `filterTraceData` from `ai/investigation-data.utils` via a direct file import (they are dependency-free pure functions — no NestJS/DI coupling, no refactor of the native path). This guarantees the MCP output is byte-identical to the chat output.
  - **Reuse the `investigationRepo`** already injected into `ReadToolsService` (used by `get_case_data`) — no new provider wiring.
  - **Bypass the 8 KB `textResult` cap** (like the two data-room read tools already in this file): return the content envelope directly. A slimmed graph routinely exceeds 8 KB; a truncated one is useless. **No size guard / summary fallback** — the native tool has none; the description steers agents to narrow with `address`/`token` (MCP has no `execute_script` escape hatch).
- **Risk concentration:** One core file (`read-tools.ts`). The one thing to get exactly right is the `caseId`-scoped `findOne` (`{ id: invId, caseId }`) so a cross-case investigation id can't be read through an authorized case. All tasks sonnet; opus terminator reviews the whole diff.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/mcp/tools/read-tools.ts` | Modify | Register `get_investigation` MCP tool (viewer-gated, caseId-scoped, cap-bypassing); reuse `investigationRepo` + `stripTraceForAgent`/`filterTraceData`. Update header docstring (8 → 9 tools). |
| 2 | `backend/src/modules/mcp/tools/read-tools.spec.ts` | Modify | Unit-cover both modes, filters, not-found, cross-case isolation, viewer gate, cap-bypass. |
| 3 | `docs/ai-system.md`, `backend/src/skills/daubert-overview.md` | Modify | Add `get_investigation` to the **MCP** tool-surface tables (18 → 19); note MCP now has graph read. |

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task.
>
> **Project rules that override defaults:** NEVER commit — leave all changes in the working tree, `git status` at the end of each task. No `Co-Authored-By` trailers. No DB migration (no schema change). No new npm deps. QA (browser) is N/A — backend-only MCP tool; verification is unit tests + `npm run build`.

## Shared design reference

### Native reference (mirror this — do NOT change it)
`backend/src/modules/ai/ai.service.ts` → `executeInvestigationTool(caseId, { investigationId?, address?, token? }, contextInvestigationId?)`:
- No id → `investigationRepo.find({ where: { caseId }, relations: ['traces'], order: { createdAt: 'ASC' } })` → map to `{ id, name, notes, traces: [{ id, name, nodeCount, edgeCount }] }`.
- With id → `investigationRepo.findOne({ where: { id: invId, caseId }, relations: ['traces'] })`; if absent → `{ error: 'Investigation <id> not found' }`; else per trace `const stripped = stripTraceForAgent(t.data); const filtered = filterTraceData(stripped, address, token); return { id, name, ...filtered }` and wrap `{ id, name, notes, traces }`.

The MCP tool differs from the native handler only by: (a) a required `caseId` input, (b) an `assertRole(principal, caseId, 'viewer')` gate as the first awaited call, (c) no `contextInvestigationId` (MCP is stateless — the id comes only from input), (d) a cap-bypassing return envelope instead of a bare object.

### Tool contract (Task 1)
Register in `ReadToolsService.registerAll`, immediately after `read_production` (keep the investigation reads adjacent to `get_case_data`). Mirror the existing tool structure exactly: `server.registerTool(name, { description, inputSchema }, handler)`, `assertRole` first, `try/catch → errorResult(e)`.

```
name: 'get_investigation'
inputSchema: {
  caseId: z.string().uuid(),
  investigationId: z.string().uuid().optional(),
  address: z.string().optional(),
  token: z.string().optional(),
}
```
Handler:
1. `await this.caseAccess.assertRole(principal, caseId, 'viewer');`
2. If no `investigationId`: `const rows = await this.investigationRepo.find({ where: { caseId }, relations: ['traces'], order: { createdAt: 'ASC' } });` → map to the summary shape → return **cap-bypassing** `{ content: [{ type: 'text' as const, text: JSON.stringify(summaries) }] }`.
3. Else: `const inv = await this.investigationRepo.findOne({ where: { id: investigationId, caseId }, relations: ['traces'] });` — if null return cap-bypassing `{ content: [{ type: 'text' as const, text: JSON.stringify({ error: \`Investigation ${investigationId} not found\` }) }] }`. Else build `traces` via `stripTraceForAgent` + `filterTraceData(stripped, address, token)`, wrap `{ id, name, notes, traces }`, return cap-bypassing.
4. `catch (e) → errorResult(e)`.

Import: `import { stripTraceForAgent, filterTraceData } from '../../ai/investigation-data.utils';` (pure functions — no DI). `investigationRepo` is already an injected member.

Description (agent-facing):
> "Read an investigation's graph. With only caseId: returns a summary of every investigation in the case (id, name, notes, and per-trace node/edge counts). With investigationId: returns the full graph per trace — nodes, edges (denormalized with from/to addresses), groups, and bundles, with visual metadata stripped. Optional address and token filters narrow to matching nodes/edges. Requires viewer access."

Update the `ReadToolsService` header docstring: bump the "eight read-only MCP tools" count to nine and add the `get_investigation` bullet in the tool list.

---

## Task 1: Register `get_investigation` on the MCP read surface

**Implementer:** sonnet
**File:** Modify `backend/src/modules/mcp/tools/read-tools.ts`.

**Steps:**
1. Add the import for `stripTraceForAgent, filterTraceData` from `../../ai/investigation-data.utils`.
2. Register `get_investigation` per the Shared design reference — placed directly after the `read_production` registration. Reuse the already-injected `this.investigationRepo` and `this.caseAccess`. Both success paths return the cap-bypassing content envelope (NOT `textResult`); the `catch` returns `errorResult(e)`.
3. Update the class header docstring (8 → 9 tools; add the `get_investigation` line).
4. `npm run build --prefix backend` green. `git status`.

---

## Task 2: Tests for `get_investigation`

**Implementer:** sonnet
**File:** Modify `backend/src/modules/mcp/tools/read-tools.spec.ts` (extend the existing harness — add an `investigationRepo` override with `find`/`findOne` mocks; the harness already injects `investigationRepo`).

**Cases (mirror existing tool-test style — build server via `registerAll`, extract handler from `_registeredTools`, invoke directly):**
- **Summaries mode** (no `investigationId`): `investigationRepo.find` returns 2 investigations each with traces carrying `data.nodes`/`data.edges`; assert the result JSON is `[{ id, name, notes, traces: [{ id, name, nodeCount, edgeCount }] }]` with correct counts; assert `caseAccess.assertRole` called with `'viewer'`; assert `find` called with `{ where: { caseId }, ... order: createdAt ASC }`.
- **Full mode** (with `investigationId`): `findOne` returns an investigation with one trace whose `data` has raw nodes (with `position`/visual fields) + edges; assert the returned trace has slimmed nodes (no visual metadata) and edges denormalized with `fromAddress`/`toAddress` (i.e. `stripTraceForAgent` ran); assert `findOne` called with `{ where: { id: investigationId, caseId }, ... }`.
- **Filter**: pass `address` (or `token`); assert only matching nodes/edges survive (`filterTraceData` ran).
- **Not found**: `findOne` returns `null` → result JSON `{ error: 'Investigation <id> not found' }`, NOT `isError`.
- **Cross-case isolation**: covered by asserting the `findOne` where-clause includes `caseId` (an id under a different case yields `null` → not-found).
- **Viewer gate**: `assertRole` rejects (ForbiddenException) → handler returns `isError` via `errorResult`.
- **Cap-bypass**: build a trace large enough that `JSON.stringify` > 8192 chars and assert the full text is returned (length > 8192), proving it did not go through `truncatedJson`.

Run `npm run test --prefix backend -- read-tools` green.
`git status`.

---

## Task 3: Docs — MCP tool surface parity

**Implementer:** sonnet
**Files:** `docs/ai-system.md`, `backend/src/skills/daubert-overview.md`.

- `docs/ai-system.md`: the **MCP** "Tool surface (18)" section — bump to **(19)** and add `get_investigation` to the **Read** row (after `get_case_data`). Do NOT touch the native `AiService.executeTool` table (line ~84), which already lists `get_investigation`.
- `backend/src/skills/daubert-overview.md`: add a `get_investigation` row to the Read-tools table (right after `get_case_data`), described as "Read investigation graph data (nodes/edges/groups/bundles); summaries without `investigationId`, full slimmed graph with it; optional `address`/`token` filters." If the "Identify the target" workflow step mentions only `list_*` tools, add that `get_investigation` reads the actual graph once the investigation is identified.
- Grep both files afterward to confirm `get_investigation` appears in the MCP-facing sections.

`git status`.

---

## Verification (end-to-end)

1. **Unit:** `npm run test --prefix backend -- read-tools` fully green (existing 8-tool coverage + the new cases).
2. **Build:** `npm run build --prefix backend` exit 0.
3. **Parity check:** the full-mode test asserting slimmed nodes + denormalized edge addresses proves the MCP output matches the native `stripTraceForAgent` contract.
4. **Cap-bypass guard:** the >8 KB test is the key regression guard (a future refactor routing this through `textResult` would break graph reads).
5. QA (browser) is N/A — no UI surface. The natural manual check for later: connect a local MCP client, call `get_investigation` with only `caseId` (summaries), then with an `investigationId` (full graph), then with an `address` filter.

## Engineering decisions made (operator can override)

- **Home = `read-tools.ts`** (not `navigate-tools.ts`): navigate-tools' documented invariant is "always `textResult` / never unbounded JSON"; a graph read must bypass the cap, and read-tools already hosts+documents the cap-bypass pattern and already injects `investigationRepo`.
- **Reuse pure utils over refactor**: direct import of `stripTraceForAgent`/`filterTraceData` from the `ai` module (dependency-free functions) rather than relocating them to a shared dir — keeps the native path untouched and output identical.
- **No size guard / no pagination** in v1: mirror the native contract; narrowing is via `address`/`token`. If real cases produce graphs too big even when slimmed, add pagination later (out of scope here).
- **No new deps, no migration, no new DI wiring.**
