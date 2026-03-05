# AI System

The AI module powers an agentic chat assistant for blockchain forensics. Built on Claude (Anthropic) with streaming, tool use, and sandboxed script execution.

## Directory Structure

```
backend/src/
├── prompts/
│   └── investigator.ts                 System prompt
├── skills/
│   ├── blockchain-apis.md              Blockchain API reference (loaded on-demand)
│   └── graph-mutations.md              Import endpoint + script pattern for graph mutations
└── modules/ai/
    ├── ai.module.ts                    NestJS module
    ├── ai.service.ts                   Agent loop + tool dispatch
    ├── conversations.service.ts        Conversation/message CRUD
    ├── conversations.controller.ts     REST + SSE endpoints
    ├── providers/
    │   ├── llm-provider.interface.ts   Provider contract
    │   └── anthropic.provider.ts       Claude SDK wrapper
    ├── services/
    │   └── script-execution.service.ts Sandboxed JS runner
    ├── tools/
    │   ├── tool-definitions.ts         Individual tool schemas
    │   └── index.ts                    AGENT_TOOLS collection
    └── dto/
        ├── chat-message.dto.ts
        └── create-conversation.dto.ts
```

## Agent Loop

`AiService.streamChat()` is the core. It runs up to **10 iterations** of:

1. Stream from Claude with system prompt + message history + tools
2. Yield `text_delta` SSE events to the client as tokens arrive
3. If `stop_reason === 'end_turn'` or no tool calls → save, yield `done`, return
4. **Repeat-tool guard** — if the exact same tool calls repeat, break to prevent loops
5. Execute each tool call, yielding `tool_start` / `tool_done` events
6. **Atomic save** — assistant message + tool results saved in a single DB transaction
7. Append to message history, loop

On the first turn, the service fires a background title generation call (Haiku model, 5 words) to name the conversation.

## LLM Provider

The `AnthropicProvider` wraps the SDK and exposes two methods:

| Method | Model | Purpose |
|--------|-------|---------|
| `streamChat()` | `claude-opus-4-6` | Agent reasoning with tools |
| `generateText()` | `claude-haiku-4-5` | Title generation (non-streaming) |

Configuration:
- **Max tokens**: 4096 per turn
- **Thinking**: Adaptive (`thinking: { type: 'adaptive' }`)
- **Beta**: `compact-2026-01-12` (automatic message compaction for long conversations)

The `LlmProvider` interface exists for future provider swaps — the service depends on the interface, not the SDK directly.

## Tools

Four tools are available to the agent (plus web search):

### `web_search`
Built-in Anthropic server-side web search. Never appears in `tool_use` blocks — handled transparently by the API.

### `get_case_data`
Fetches the investigation graph (all investigations, traces, wallet nodes, transaction edges) for the current case. Accepts an optional `investigationId` to scope to one investigation.

### `get_skill`
Loads a markdown skill document into context. Available: `blockchain-apis` (Etherscan V2 + Tronscan + TronGrid API reference), `graph-mutations` (import endpoint format + script pattern for adding nodes/edges).

### `execute_script`
Writes and runs JavaScript in a sandboxed Node.js child process. Designed for batch blockchain API calls and graph mutations — e.g., fetch transactions for 10 addresses, then POST to the import endpoint to add them to the graph.

**Input**: `{ name: string, code: string }`

### `list_script_runs`
Returns the last 20 script runs for the current investigation (output truncated to 2KB per run). The agent checks this before re-running a script.

## Tool Dispatch

`AiService.executeTool()` uses a switch on tool name:

```
get_case_data    → query InvestigationEntity with traces relation
get_skill        → read markdown file from src/skills/
execute_script   → ScriptExecutionService.execute()
list_script_runs → ScriptExecutionService.listRuns()
default          → { error: "Unknown tool" }
```

Both `execute_script` and `list_script_runs` require an `investigationId` from the chat request. If missing, the tool returns an error asking the user to select an investigation.

## Script Execution

`ScriptExecutionService` runs agent-generated JavaScript in an isolated child process.

### Constraints

| Constraint | Value |
|-----------|-------|
| Timeout | 30 seconds |
| Output limit | 100KB (truncated + process killed) |
| Runtime | Node.js with `--input-type=module` (ESM) |
| Available globals | `fetch()`, `console`, `process.env` |
| Env vars | `ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`, `API_URL`, `HOME` |
| No access to | Filesystem, npm modules, network (except fetch) |

### How It Works

1. Agent code is wrapped in an async IIFE with try/catch (enables top-level `await`)
2. Code is sent via **stdin** (not `-e` flag — avoids arg length limits)
3. stdout + stderr are captured into a combined output string
4. If output exceeds 100KB → truncate, SIGKILL the process
5. On close: check signal/exit code → determine status (`success` / `error` / `timeout`)
6. Persist to `script_runs` table with name, code, output, status, duration
7. Return result to the agent

### Persistence

Every script execution is saved to the `script_runs` table, linked to the investigation by `investigationId`. The frontend shows these in the sidebar's Scripts section, and the details panel displays code + output with syntax tabs.

## System Prompt

Located at `src/prompts/investigator.ts`. The prompt:
- Sets the role as a blockchain forensics analyst
- Lists all available tools with brief descriptions
- Provides guidelines: use Markdown formatting, cite sources, flag suspicious patterns
- Directs the agent to load the `blockchain-apis` skill before making API calls
- Encourages `execute_script` for batch operations over sequential tool calls
- Tells the agent to check `list_script_runs` before re-running scripts

## Skills

Skill documents live in `src/skills/` as markdown files.

### `blockchain-apis.md`

Covers:
- **Etherscan V2** — 7 chain IDs, 12 endpoints (account, contract, gas, stats)
- **Tronscan API** — 9 endpoints (account, transaction, transfer, contract, price)
- **TronGrid v1** — 3 endpoints (account, transactions, TRC-20)
- **Usage notes** — Wei/Sun conversion, address formats, timestamp formats
- **Script patterns** — Etherscan/Tronscan fetch helpers, `Promise.all` parallel calls, rate-limit-aware batching

### `graph-mutations.md`

Covers:
- **Import endpoint** — `POST /traces/:id/import-transactions` request/response format
- **Field reference** — from, to, txHash, chain, timestamp, amount, token, blockNumber
- **Native currency table** — ETH, MATIC, TRX per chain
- **Script pattern** — Fetch from Etherscan → map to import format → POST to endpoint
- **Tips** — Use `get_case_data` for traceId, dedup is safe, batch large datasets

## Conversations & Messages

`ConversationsService` handles persistence:
- Conversations have a nullable `title` (auto-set after first exchange)
- Messages store `role` (`user` | `assistant`) and `content` as a JSONB array
- Content preserves Anthropic block types verbatim: `text`, `tool_use`, `tool_result`, `thinking`, compaction blocks
- Tool results are saved as `user` role messages (Anthropic's convention)

## SSE Event Types

The chat endpoint (`POST /conversations/:id/chat`) streams these events:

| Event | Data | When |
|-------|------|------|
| `text_delta` | `{ content: string }` | Each streamed token |
| `tool_start` | `{ name: string, input: object }` | Tool execution begins |
| `tool_done` | `{ name: string }` | Tool execution complete |
| `graph_updated` | `{}` | Graph data changed (after script execution) |
| `done` | `{ conversationId: string }` | Agent turn finished |
| `error` | `{ message: string }` | Unrecoverable error |
