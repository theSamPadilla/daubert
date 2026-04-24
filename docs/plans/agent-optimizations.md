# Agent Optimizations

## Atomized Changes

### Already landed

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/ai/providers/anthropic.provider.ts` | Modify | Cache last tool definition, accept system as content blocks |
| 2 | `backend/src/modules/ai/providers/llm-provider.interface.ts` | Modify | System param type: string -> BetaTextBlockParam[] |
| 3 | `backend/src/modules/ai/ai.service.ts` | Modify | Prompt caching, slim history, message merging, cache breakpoints |
| 4 | `backend/src/modules/ai/conversations.controller.ts` | Modify | SSE heartbeat (15s interval) |

### Backlog (not yet started)

| # | File | Action | Purpose |
|---|------|--------|---------|
| 5 | `backend/src/database/entities/token-usage.entity.ts` | Create | Entity for per-request token consumption logging |
| 6 | `backend/src/modules/ai/services/usage.service.ts` | Create | Log token usage, compute cost estimates, cache hit rates |
| 7 | `backend/src/modules/ai/ai.service.ts` | Modify | Extract token metrics from API response, call usage service |
| 8 | `backend/src/modules/ai/providers/anthropic.provider.ts` | Modify | Yield usage metadata from stream finalMessage |
| 9 | `backend/src/modules/ai/services/compression.service.ts` | Create | Haiku-based conversation summarization when approaching token budget |
| 10 | `frontend/src/app/cases/[caseId]/admin/page.tsx` | Create | Token usage dashboard (future, after auth/routing lands) |

Ideas borrowed from Stackpad and adapted for Daubert. Some already implemented, rest is a backlog.

---

## Done

### Prompt Caching (system + tools + messages)
- System prompt wrapped with `cache_control: { type: 'ephemeral' }` so it's cached across all requests
- Last tool definition gets `cache_control` — caches the entire tools array
- Two message-history breakpoints: end of old DB history (cached between user turns) and end of new user message (cached within agent loop iterations)
- Net effect: only the new content (latest user message, tool results from current loop) is processed fresh on each API call

### Slim History
- Tool results trimmed before DB persistence; full results stay in memory for current agent loop
- `get_case_data` -> summary with investigation/trace/node/edge counts
- `get_skill` -> `{ loaded: true }` stub (model can re-load)
- `execute_script` / `list_script_runs` -> capped at 2000 chars
- Default cap: 3000 chars for any tool result

### SSE Heartbeat
- 15-second heartbeat via SSE comment lines (`: heartbeat\n\n`)
- Prevents proxy/load-balancer timeouts during long tool executions (scripts can take 30s)

### Message Merging
- Consecutive same-role messages collapsed before API call
- Prevents alternating-role violations from compaction or DB ordering artifacts

---

## Backlog

### Conversation Compression
When conversations get long (approaching context limits), compress older messages:
1. Flush important context to a "memory" summary using a cheap model (Haiku)
2. Summarize older messages into a single summary block
3. Archive originals somewhere (or just discard — we have the DB)
4. Replace old messages with summary in the conversation history

Stackpad does: memory flush -> Haiku summarization -> R2 archive -> replace.
We could simplify: just summarize with Haiku and replace in-place. Keep originals in DB but don't load them into the API call.

Token budget system: define a ceiling (e.g. 150K tokens), reserve space for response + safety margin, keep recent N tokens untouched, compress everything older.

### Token Usage Tracking & Admin Visibility
Track token consumption per conversation and surface it in an admin view:
- Log `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` from each API response
- Store in a `token_usage` table: conversationId, model, input/output/cacheRead/cacheCreation, timestamp
- Build an admin page or dashboard panel showing:
  - Total tokens consumed (daily, weekly, all-time)
  - Cost estimates (map token counts to per-model pricing)
  - Cache hit rate (cache_read vs total input) — validates that caching is actually working
  - Per-conversation breakdown (which investigations are expensive)
  - Per-model breakdown (Opus vs Sonnet vs Haiku spend)
  - Trend over time (are optimizations reducing cost?)
- Could be a simple table view initially, charts later
- Useful for understanding where money is going and whether optimizations are landing

### Model Fallback / Budget Caps
- Set a per-conversation or per-day token budget
- When budget approaches limit, auto-downgrade from Opus to Sonnet to Haiku
- Or just warn in the UI and let the user decide
- Stackpad does tier-based fallback (Advanced -> Base) with monthly usage tracking and atomic UPSERT counters

### Rate Limiting on Chat Endpoints
- Add `@nestjs/throttler` to protect chat endpoints
- Something like 5 req/10sec on `/conversations/:id/chat`
- Not critical while single-user, but good hygiene before going multi-user
- Stackpad uses named rate limit tiers: default (60/min), chat (5/10sec), etc.

### Image Stripping on Subsequent Turns
- After the first API call that processes an image attachment, replace the base64 data with a text placeholder `[User shared an image]` in the stored message
- Prevents re-sending large image payloads on every subsequent turn
- Only matters for conversations with image attachments, but those are expensive

### Prompt Layering (Stable/Dynamic Split)
- Currently the system prompt is a single static string
- Could split into layers like Stackpad:
  - Layer 1 (stable, cached): base investigator prompt
  - Layer 2 (stable, cached): case-specific context (case name, investigation names, known entities)
  - Layer 3 (dynamic): current graph state summary, active trace info
- The dynamic layer changes per navigation but the stable prefix stays cached
- Would require passing case/investigation context into the system prompt builder

### Background Script Execution
- Currently scripts run synchronously within the agent loop, blocking the stream
- Could move to a job queue pattern: spawn script, return job ID, poll for completion
- Agent would get a `check_script_status` tool instead of blocking
- Probably overkill unless scripts start taking longer or we want parallel execution

### Fire-and-Forget Hardening
- Audit all `.catch()` patterns for non-critical async work (title gen, etc.)
- Make sure nothing produces unhandled rejections
- Add structured logging for failures (not just console.log)

### Thinking Token Optimization
- Currently using `thinking: { type: 'adaptive' }` which lets the model decide
- Could experiment with disabling thinking for simple turns (follow-ups, acknowledgments) and only enabling for analytical queries
- Or set a thinking budget to cap reasoning tokens on expensive models
