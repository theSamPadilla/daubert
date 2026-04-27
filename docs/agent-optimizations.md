# Agent Optimizations

Design notes for the agent loop in `backend/src/modules/ai`. This doc covers
optimizations already in place and one larger future project.

## Status

| # | Optimization | Status | Where |
|---|---|---|---|
| 1 | Stream-layer block filtering | ✓ Shipped 2026-04-26 | `providers/anthropic.provider.ts` |
| 2 | Production-only tool-result slimming | ✓ Shipped earlier; narrowed 2026-04-27 | `ai.service.ts` (`slimToolResult`) |
| 3 | Prompt cache breakpoints | ✓ Shipped earlier | `ai.service.ts` + `providers/anthropic.provider.ts` |
| 4 | Token-budget compaction with Haiku | Deferred — see criteria below | — |

## In place

### Stream-layer block filtering

`AnthropicProvider.streamChat` strips these block types from `response.content`
before yielding the final message:

- `thinking`, `redacted_thinking` — adaptive thinking is useful within a turn
  but we don't carry reasoning across turns.
- `server_tool_use`, `code_execution`, `code_execution_tool_result`,
  `server_tool_result` — adaptive thinking sometimes emits server-side
  code-execution blocks, but they have no matching results on subsequent
  requests and would cause `tool_use without a corresponding tool_result` 400s.

By filtering at the stream layer, the rest of the system never sees these
blocks. The DB only ever stores text + user-defined tool_use / tool_result
blocks. (Stackpad takes the same approach.)

> **Why this matters:** before this filter, persisted `thinking` blocks
> caused intermittent `messages.N.content.M.thinking.cache_control: Extra
> inputs are not permitted` 400s. The cache breakpoint code stamped
> `cache_control` on the tail block of the prior assistant message, and after
> stripping server-side blocks the tail was sometimes a `thinking` block
> (which the API rejects `cache_control` on). Filtering at the stream layer
> made the bug class structurally impossible.

### Production-only tool-result slimming

`slimToolResult(toolName, full)` in `ai.service.ts` slims **only** the three
Production tools (`create_production`, `read_production`, `update_production`)
for DB persistence:

- Single production → `{id, name, type}` (heavy `data` field dropped)
- Array of productions → same per item
- Fallback if shape is unexpected → capped at 3KB

Full results stay in memory for the current agent loop; only the slim version is
persisted. The model can re-read a production's full body via `read_production`
when needed.

Every other tool result (`get_case_data`, `get_skill`, `list_script_runs`,
`query_labeled_entities`, `execute_script`) is **persisted verbatim**.
Originally we slimmed retrieval results too, but it backfired: the model would
see consecutive summaries in conversation history and conclude that re-calling
wouldn't return more — even though the live tool returned full data. Trusting
the history matters more than saving DB bytes for these tools.

No Haiku calls — slimming is a deterministic heuristic.

### Prompt cache breakpoints

Three cache breakpoints per request:

1. **System prompt** — stable across all requests in a conversation.
2. **End of old history** — caches prior turns so they aren't re-processed when
   a new user message arrives.
3. **End of new user message** — caches the user turn so iterations 1+ of the
   agent loop (after each tool result) don't re-process it.

Combined with `compact-2026-01-12` beta header, this keeps token usage roughly
linear in *new* content per turn rather than total conversation length.

## Deferred: token-budget compaction with Haiku

The above optimizations bound the *per-tool-result* size, but the conversation
itself still grows unbounded. Long investigations will eventually exceed the
context window. The fix is conversation-level compaction — a separate project,
not a quick patch.

### Approach (mirrors stackpad's `CompressionService`)

When the message history exceeds a token budget (~150K of the 200K window,
leaving headroom for the system prompt + new turn):

1. **Memory flush.** Use Sonnet to extract durable state from the messages
   about to be archived — case findings, working hypotheses, key wallet
   addresses, scratch decisions. Persist to a `MEMORY` block prepended to the
   system prompt for future requests.
2. **Summarize.** Use Haiku to produce a short narrative summary of the
   archived span ("User investigated Sun Wallet's NFT holdings; found 3
   suspicious counterparties at addresses X, Y, Z; ran scripts A, B, C with
   results...").
3. **Archive.** Move the original messages to cold storage (R2 or a
   `messages_archive` table) keyed by conversation. Delete from `messages`.
4. **Insert summary.** Replace the archived span with a single synthetic
   `assistant` message containing the Haiku summary as its only block.

### Why Haiku here, not per-tool-result

A Haiku call costs ~$0.0001 per typical summary call. Per-tool-result
summarization would mean one Haiku call per agent iteration — adds 200-400ms
latency on every loop iteration, plus the cost. Conversation-level compaction
runs once per ~150K tokens, so the cost amortizes over hundreds of turns.

### What it would touch

- New service: `CompactionService` with `shouldCompact()`, `compact()`.
- New entity: `MessageArchive` (or R2 bucket).
- `AiService.streamChat` checks `shouldCompact()` before each request.
- Token counting: use `@anthropic-ai/tokenizer` or hit the `count_tokens`
  endpoint.
- Frontend: surface a "compacted earlier history" affordance so the user knows
  prior context was summarized.

### Decision criteria

Build this when:
- Conversations regularly exceed 100K tokens, **or**
- Users complain about losing context in long investigations, **or**
- Cache misses become a major cost line.

Until then, the existing tool-result slimming + cache breakpoints handle most
real conversations within budget.

### References

- Stackpad's `CompressionService`: `backend/src/modules/agent/services/compression.service.ts`
- Stackpad's per-tool slim: `backend/src/modules/agent/tools/slim-history.ts`
- Anthropic `compact-2026-01-12` beta header (currently used by daubert) does
  some server-side compaction but is not a substitute for explicit memory flush.
