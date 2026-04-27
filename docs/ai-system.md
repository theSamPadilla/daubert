# AI System

The AI module powers an agentic chat assistant for blockchain forensics. Built on Claude (Anthropic) with streaming, tool use, and sandboxed script execution.

## Directory Structure

```
backend/src/
├── prompts/
│   └── investigator.ts                 System prompt
├── skills/
│   ├── blockchain-apis.md              Blockchain API reference
│   └── graph-mutations.md              Import endpoint + script pattern
└── modules/ai/
    ├── ai.module.ts                    NestJS module
    ├── ai.service.ts                   Agent loop + tool dispatch
    ├── ai.controller.ts               Script rerun endpoint
    ├── conversations.service.ts        Conversation/message CRUD
    ├── conversations.controller.ts     REST + SSE endpoints
    ├── providers/
    │   ├── llm-provider.interface.ts   Provider contract
    │   └── anthropic.provider.ts       Claude SDK wrapper
    ├── services/
    │   └── script-execution.service.ts isolated-vm V8 sandbox
    ├── tools/
    │   ├── tool-definitions.ts         Individual tool schemas
    │   └── index.ts                    AGENT_TOOLS collection
    └── dto/
        ├── chat-message.dto.ts
        └── create-conversation.dto.ts
```

## Agent Loop

`AiService.streamChat()` runs up to 10 iterations:

1. Stream from Claude with system prompt + message history + tools
2. Yield `text_delta` SSE events as tokens arrive
3. If `stop_reason === 'end_turn'` or no tool calls → save, yield `done`, return
4. Repeat-tool guard — if exact same tool calls repeat, break
5. Execute each tool call, yielding `tool_start`/`tool_done` events
6. Strip server-side blocks (`server_tool_use`, `server_tool_result`, `code_execution`, `code_execution_tool_result`) from response before saving — these are ephemeral from adaptive thinking and poison future requests if persisted
7. Two-phase save — assistant message saved first, then tool results in a separate save so each row gets a distinct `created_at` timestamp (prevents ORDER BY non-determinism)
8. Full results kept in-memory for current loop; slim (truncated) versions saved to DB for future requests
9. Append to history, loop

On the first message in a conversation, fire background title generation (Haiku, 5 words max, truncated to 40 chars).

Message loading also strips `server_tool_use`/`server_tool_result`/`code_execution`/`code_execution_tool_result` from DB history as a safety net for messages persisted before the save-time filter existed. `sanitizeToolPairs` removes orphaned tool_use/tool_result blocks. `mergeConsecutiveRoles` fixes adjacent same-role messages. On orphaned-tool 400 errors from the API, auto-retry once after stripping.

## LLM Provider

`AnthropicProvider` wraps the SDK:

| Method | Model | Purpose |
|--------|-------|---------|
| `streamChat()` | `claude-opus-4-6` (default, configurable) | Agent reasoning with tools |
| `generateText()` | `claude-haiku-4-5` | Title generation (non-streaming) |

Config: max_tokens 4096, thinking: adaptive, beta: compact-2026-01-12 (message compaction), prompt caching on system + tools + message breakpoints.

## Tools (8 + web search)

### `web_search`
Built-in Anthropic server-side search. Transparent to tool dispatch.

### `get_case_data`
Fetch investigation graph (investigations, traces, nodes, edges). Optional `investigationId` to scope.

### `get_skill`
Load markdown skill document. Available: `blockchain-apis`, `graph-mutations`.

### `execute_script`
Run JavaScript in an **isolated-vm V8 sandbox**. Input: `{ name, code }`.

### `list_script_runs`
Last 20 script runs for the investigation (output truncated to 2KB each).

### `query_labeled_entities`
Search entity registry by address, name, or category.

### `create_production`
Create a report (HTML), chart (Chart.js data), or chronology.

### `read_production`
Read a production by ID or list all for the investigation.

### `update_production`
Update a production's name or data (full replacement).

## Tool Dispatch

```
get_case_data         → query InvestigationEntity with traces relation
get_skill             → read markdown from src/skills/
execute_script        → ScriptExecutionService.execute()
list_script_runs      → ScriptExecutionService.listRuns()
query_labeled_entities→ LabeledEntitiesService.lookupByAddress() or findAll()
create_production     → ProductionsService.create()
read_production       → ProductionsService.findOne() or findAllForCase()
update_production     → ProductionsService.update()
default               → { error: "Unknown tool" }
```

## Script Execution (isolated-vm sandbox)

Scripts run in a **V8 isolate** (via `isolated-vm` npm package), NOT a child process. The isolate has zero access to Node.js APIs — no `fs`, `child_process`, `net`, `os`, `require`, or `import`.

### What's available inside the sandbox
- `fetch()` — bridged to host-side, domain-whitelisted, redirect-blocked, https-only (http only for localhost in dev)
- `console.log/error/warn/info` — captured to output buffer
- `process.env` — frozen, read-only subset: `ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`, `API_URL`

### Constraints

| Constraint | Value |
|-----------|-------|
| Timeout | 30s (both CPU via eval timeout AND wall-clock via Promise.race) |
| Output limit | 100KB (truncated) |
| Memory limit | 128MB per isolate |
| Max concurrent | 2 (semaphore) |
| Strict mode | Yes ('use strict' in harness) |
| Redirects | Blocked (redirect: 'error') |
| Scheme | https only (http for loopback in dev only) |

### Domain allowlist
Etherscan (7 chains), Tronscan, TronGrid, localhost (dev only). Extensible via `SCRIPT_ALLOWED_DOMAINS` env var.

### Persistence
Every execution saved to `script_runs` table with name, code, output, status, duration, investigationId.

## System Prompt

`src/prompts/investigator.ts` — sets role as blockchain forensics analyst, lists tools, provides guidelines for Markdown formatting, skill loading, batch operations, deduplication.

## Skills

- `blockchain-apis.md` — Etherscan V2 (7 chains, 12 endpoints), Tronscan (9 endpoints), TronGrid v1 (3 endpoints), script patterns
- `graph-mutations.md` — Import endpoint format, field reference, native currency table, script patterns

## SSE Event Types

| Event | Data | When |
|-------|------|------|
| `text_delta` | `{ content }` | Each streamed token |
| `tool_start` | `{ name, input }` | Tool execution begins |
| `tool_done` | `{ name }` | Tool execution complete |
| `graph_updated` | `{}` | Graph changed (after script execution) |
| `done` | `{ conversationId }` | Agent turn finished |
| `error` | `{ message }` | Unrecoverable error |
