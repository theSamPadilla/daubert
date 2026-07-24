# AI System

The AI module powers an agentic chat assistant for blockchain forensics. Built on Claude (Anthropic) with streaming, tool use, sandboxed script execution, and an MCP server for bring-your-own-agent access.

Related: [architecture.md](./architecture.md), [exec-environment.md](./exec-environment.md), [declarations.md](./declarations.md), [redlining.md](./redlining.md), [organizations.md](./organizations.md), [data-room.md](./data-room.md).

## Directory Structure

```
backend/src/
├── prompts/
│   └── investigator.ts                 System prompt
├── skills/
│   ├── skill-registry.ts               Auto-loads *.md skills from frontmatter
│   ├── daubert-overview.md
│   ├── declarations.md
│   ├── etherscan-apis.md
│   ├── graph-mutations.md
│   ├── product-knowledge.md
│   ├── productions.md
│   ├── redlining.md
│   └── tronscan-apis.md
└── modules/
    ├── ai/
    │   ├── ai.module.ts
    │   ├── ai.service.ts               Agent loop + tool dispatch
    │   ├── ai.controller.ts            Script rerun endpoint
    │   ├── conversations.service.ts    Conversation/message CRUD
    │   ├── conversations.controller.ts REST + SSE endpoints
    │   ├── attachment-blocks.ts        Chat attachments to content blocks
    │   ├── investigation-data.utils.ts Graph slimming for tool results
    │   ├── providers/
    │   │   ├── llm-provider.interface.ts
    │   │   └── anthropic.provider.ts   Claude SDK wrapper
    │   ├── services/
    │   │   └── script-execution.service.ts   isolated-vm V8 sandbox
    │   ├── tools/
    │   │   ├── tool-definitions.ts     Core tool schemas
    │   │   ├── label-tools.ts          Graph label tools
    │   │   └── index.ts                AGENT_TOOLS / READ_ONLY_AGENT_TOOLS
    │   └── dto/
    ├── declarants/                     Declarant profiles + CV extraction
    ├── mcp/                            MCP server (bring-your-own-agent)
    ├── oauth/                          OAuth 2.1 AS for MCP clients
    └── superadmin/token-usage/         Token metering + pricing
```

## Agent Loop

`AiService.streamChat()` runs up to 10 iterations (`MAX_ITERATIONS`):

1. Stream from Claude with cached system prompt + message history + role-appropriate tool set (`AGENT_TOOLS` for editors/owners, `READ_ONLY_AGENT_TOOLS` for viewers)
2. Yield `text_delta` SSE events as tokens arrive
3. If `stop_reason === 'end_turn'` or no tool calls: save, record token usage (surface `chat`), yield `done`, return
4. Repeat-tool guard: if the exact same tool name + input repeats between iterations, break
5. Execute each tool call serially, yielding `tool_start`/`tool_done` (plus `graph_updated` after `execute_script`, `production_updated` after `create_production`/`update_production`)
6. Two-phase save: assistant message first, then tool results in a separate save so each row gets a distinct `created_at` (prevents ORDER BY non-determinism)
7. Full tool results kept in-memory for the current loop; slim (truncated) versions saved to DB for future requests
8. Thread the Anthropic container id (`response.container?.id`) into the next iteration so server-side code execution keeps state within a loop
9. Append to history, loop. A `finally` block persists a synthetic terminator assistant message if the loop exits with the DB tail at `user(tool_result)` (required by the compaction beta's turn-shape rules)

On the first message in a conversation, fire background title generation (Haiku, 5 words max, truncated to 30 chars).

The provider strips server-side and thinking blocks at the stream layer, so persisted history is already clean of them. Message loading applies three sanitizers in order: `dropOrphanServerToolResults` (intra-message orphan `web_search_tool_result`/`code_execution_tool_result` blocks), `sanitizeToolPairs` (cross-message orphan client `tool_use`/`tool_result` pairs), `mergeConsecutiveRoles` (API requires strictly alternating roles).

## LLM Provider

`AnthropicProvider` wraps the SDK:

| Method | Default model | Purpose |
|--------|---------------|---------|
| `streamChat()` | `claude-opus-4-8` | Agent reasoning with tools (streaming) |
| `generateText()` | `claude-haiku-4-5` | Title generation (non-streaming) |
| `extractJson()` | `claude-sonnet-4-6` | Forced-tool structured extraction (declarants) |

Config: max_tokens 32000 (covers thinking + tool_use + text), thinking adaptive, betas `compact-2026-01-12` (message compaction) + `files-api-2025-04-14`, prompt caching on system + tools + message breakpoints.

The frontend model picker (`frontend/src/components/Workspace/AIChat.tsx`) offers `claude-opus-4-8` (Opus 4.8, default), `claude-sonnet-5` (Sonnet 5), and `claude-haiku-4-5` (Haiku 4.5); the selected id is passed per request and overrides the provider default.

## Tools

`AGENT_TOOLS` (`tools/index.ts`) = `web_search` + 13 core tools + 5 label tools. `READ_ONLY_AGENT_TOOLS` (viewers) omits `create_production`, `update_production`, and the label tools.

| Tool | Purpose |
|------|---------|
| `web_search` | Anthropic server-side search (`web_search_20260209`); never reaches tool dispatch |
| `get_case_data` | High-level case overview: investigations, productions, data-room manifest (not graph data) |
| `get_investigation` | Investigation graph data; summaries without `investigationId`, full graph with it; optional `address`/`token` filters |
| `get_skill` | Load a markdown skill into context; `name` enum generated from the skill registry |
| `execute_script` | Run JavaScript in the isolated-vm V8 sandbox; `{ name, code }` |
| `list_script_runs` | Last 20 script runs for the case (output truncated) |
| `query_labeled_entities` | Search entity registry by address, name, or category |
| `create_production` | Create a `report` (HTML), `chart` (Chart.js), `chronology`, `declaration` (typed schema; requires `formatId`, see [declarations.md](./declarations.md)), or `redline` (requires `sourceFileId`, see [redlining.md](./redlining.md)) |
| `read_production` | Read one production by id or list all for the case |
| `update_production` | Rename, apply atomic ops (chronology + declaration + redline), or full-replace data (redline is ops-only; full-replace 400s) |
| `get_declaration_library` | List the org's reusable declaration boilerplate blocks |
| `get_declarants` | List the org's saved declarant (expert) profiles |
| `list_data_room_files` | List the case's data-room files |
| `read_data_room_file` | Read a data-room file into the conversation (PDF/image/xlsx/docx/csv/txt) |
| `add_label` / `update_label` / `delete_label` / `move_label` / `tether_label` | Manipulate free-floating labels on the investigation graph |

## Tool Dispatch

`AiService.executeTool()` switch:

```
get_case_data           → InvestigationEntity + ProductionsService.findAllForCase + DataRoomService.getManifest
get_investigation       → InvestigationEntity with traces (slimmed via investigation-data.utils)
get_skill               → getSkillContent() from skill registry
execute_script          → ScriptExecutionService.execute()
list_script_runs        → ScriptExecutionService.listRunsForCase()
query_labeled_entities  → LabeledEntitiesService.lookupByAddress() or findAll()
create_production       → ProductionsService.create()
read_production         → ProductionsService.findOne() or findAllForCase()
update_production       → ProductionsService.update()
get_declaration_library → DeclarationLibraryService.listForOrg()
get_declarants          → DeclarantsService.listForOrg()
add/update/delete/move/tether_label → TracesService.findOne()/update() on trace label array
list_data_room_files    → DataRoomService.getManifest()
read_data_room_file     → executeReadDataRoomFile() (Files API upload for oversized PDFs)
default                 → { error: "Unknown tool" }
```

## Script Execution (isolated-vm sandbox)

Scripts run in a **V8 isolate** (via `isolated-vm`), not a child process. The isolate has zero access to Node.js APIs: no `fs`, `child_process`, `net`, `os`, `require`, or `import`. See [exec-environment.md](./exec-environment.md) for the full reference.

### What's available inside the sandbox
- `fetch()`: bridged host-side, domain-whitelisted, redirect-blocked, https-only (http only for localhost in dev)
- `console.log/error/warn/info`: captured to output buffer
- `process.env`: frozen, read-only subset (`ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`, `API_URL`)

### Constraints

| Constraint | Value |
|-----------|-------|
| Timeout | 30s (CPU via eval timeout and wall-clock via Promise.race) |
| Output limit | 100KB (truncated) |
| Memory limit | 128MB per isolate |
| Max concurrent | 2 (semaphore) |
| Strict mode | Yes ('use strict' in harness) |
| Redirects | Blocked (redirect: 'error') |
| Scheme | https only (http for loopback in dev only) |

### Domain allowlist
Etherscan (7 chains), Tronscan, TronGrid, localhost (dev only). Extensible via `SCRIPT_ALLOWED_DOMAINS` env var.

### Persistence
Every execution saved to `script_runs` with name, code, output, status, duration, investigationId.

## System Prompt

`src/prompts/investigator.ts`: sets role as blockchain forensics analyst, lists tools, provides guidelines for Markdown formatting, skill loading, batch operations, deduplication.

## Skills

`backend/src/skills/skill-registry.ts` auto-loads every `.md` file in `backend/src/skills/` at import time, parsing `name` and `description` from YAML frontmatter (throws if either is missing). It exports `SKILL_REGISTRY`, `SKILL_NAMES` (used as the `get_skill` input enum), and `getSkillContent(name)` (returns the body with frontmatter stripped). Adding a skill is dropping a markdown file in the directory; no code change.

| Skill | Covers |
|-------|--------|
| `daubert-overview` | Orientation for a connected agent: what Daubert is, MCP tool surface, fetch/import workflow, access model, execution constraints |
| `declarations` | Drafting court-ready declarations across five jurisdiction formats; the declaration production type, structured ops, exhibit conventions |
| `etherscan-apis` | Etherscan V2 API reference for 7 EVM chains |
| `graph-mutations` | Adding, editing, deleting nodes, edges, and groups via scripts |
| `product-knowledge` | Daubert product overview for answering user questions about the tool |
| `productions` | Creating reports (HTML), charts (Chart.js), and chronologies |
| `redlining` | Reviewing and redlining a draft document against the case record — anchored ops, verify-before-propose workflow |
| `tronscan-apis` | Tronscan and TronGrid API reference for TRON |

## Token Usage Metering

`TokenUsageService` (`modules/superadmin/token-usage/`) writes one `token_usage` row per model call: `orgId`, `userId`, `caseId`, `conversationId`, `messageId` (nullable FKs), `surface`, `model`, `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreation5mInputTokens`, `cacheCreation1hInputTokens`. Cost is not stored; it is computed on read from `pricing.ts`. A `monthly_usage` rollup is upserted when both `orgId` and `userId` are present. Writes are wrapped in try/catch so metering failures never break the user request.

Surfaces (`TokenUsageSurface`):

| Surface | Recorded when |
|---------|---------------|
| `chat` | Per agent-loop Claude call that terminates the turn |
| `title-generation` | Once per conversation, on the first message (background) |
| `declarant-extraction` | Once per CV / prior-declaration extraction call |

## Declarant Extraction

`DeclarantExtractionService` (`modules/declarants/declarant-extraction.service.ts`) drafts a declarant profile from an uploaded PDF (CV or prior declaration):

- PDF passed as an inline base64 `document` content block alongside a source-specific prompt (`CV_PROMPT` or `PRIOR_DECLARATION_PROMPT`)
- Calls `AnthropicProvider.extractJson()` with **forced tool_choice** (`{ type: 'tool', name: 'draft_declarant' }`), non-streaming, model `claude-sonnet-4-6`, max_tokens 4096
- The `draft_declarant` schema has all-optional fields (`displayName`, `title`, `firm`, `qualifications[]`, `priorTestimony[]`, `hourlyRate`, `nonContingencyDisclosure`, `dateOfBirth`, `address`, `cvExhibit`) so the model omits unknowns instead of inventing
- Anthropic size/page-limit errors surface as 400; other provider failures as 502
- Metered under surface `declarant-extraction` (org + user only; no case/conversation)

Used by `DeclarantsModule` to prefill the declarant form; the draft is reviewed in the UI before anything is saved. See [declarations.md](./declarations.md).

## MCP Server (bring-your-own-agent)

`modules/mcp/` exposes the same case data to external agents (Claude, IDEs, custom clients) over a single stateless `POST /mcp` endpoint using `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`.

**Connect (OAuth 2.1):** clients discover the server via RFC 8414 / RFC 9728 metadata endpoints, register via RFC 7591 dynamic client registration (`POST /oauth/register`), then run the authorize flow: `GET /oauth/authorize` validates parameters and redirects to the frontend consent page, where the user picks the organization to grant (the picker is built backend-side from their memberships); `POST /oauth/authorize/complete` issues the code, exchanged at `POST /oauth/token` (PKCE S256 only, scope `daubert:agent`). Users can list and revoke sessions via `GET /me/oauth-sessions` and `POST /me/oauth-sessions/:id/revoke`.

**Session principal:** every call is authenticated by `McpAuthHelper`: bearer token validation, then a per-call re-check of the owner's `organization_members` row (removal or downgrade to guest rejects immediately with `membership_revoked`, even mid-token-TTL), then a 60 req/60s per-session throttle. Success yields `{ kind: 'mcp', userId, organizationId, sessionId }`; the principal is org-bound, and case-scoped tools additionally call `CaseAccessService.assertRole()` per call.

**Tool surface (19):**

| Group | Tools |
|-------|-------|
| Navigate | `list_cases`, `get_case`, `list_investigations` |
| Read | `get_case_data`, `get_investigation`, `read_production`, `query_labeled_entities`, `get_skill`, `get_declarants`, `get_declaration_library`, `list_data_room_files`, `read_data_room_file` |
| Blockchain | `blockchain_fetch_history`, `blockchain_get_transaction`, `blockchain_get_address_info` |
| Write | `create_investigation`, `import_transactions`, `create_production`, `update_production` |

`list_data_room_files` / `read_data_room_file` give MCP the same data-room file access as chat — full manifest (up to 500 files) and extracted-text/image reads, both viewer-gated (see [data-room.md](./data-room.md)).

Seven skills (`daubert-overview`, `graph-mutations`, `etherscan-apis`, `tronscan-apis`, `productions`, `declarations`, `redlining`) are also registered as MCP prompts; `product-knowledge` is chat-only.

**Audit:** the four write tools log every call (success and failure) to `agent_audit_log` via `AgentAuditService` with session, user, org, action, status, and target ref; audit-write failures are swallowed so they never mask a tool result. Users see their own agent activity at `GET /me/agent-actions`. Read tools are not written to `agent_audit_log`; the exception is `read_data_room_file`, which writes an `agent_read` row to the data room's own `data_room_access_log` (chain-of-custody) — the same log entry the chat surface writes, since both call the same `DataRoomService` method.

## SSE Event Types

| Event | Data | When |
|-------|------|------|
| `text_delta` | `{ content }` | Each streamed token |
| `tool_start` | `{ name, input }` | Tool execution begins |
| `tool_done` | `{ name }` | Tool execution complete |
| `graph_updated` | `{}` | After `execute_script` (graph may have changed) |
| `production_updated` | `{}` | After `create_production` / `update_production` |
| `done` | `{ conversationId }` | Agent turn finished |
| `error` | `{ message }` | Non-`end_turn` termination or unrecoverable error |
