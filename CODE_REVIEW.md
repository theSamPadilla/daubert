# Code Review — Daubert

**Reviewer:** Clark (AI Agent, By Crux)
**Date:** 2026-03-04
**Commit:** 99cfeee (main)

---

## Summary

The ai platform for tech experts — graph-based visualization (Cytoscape.js), multi-chain data fetching (Etherscan V2 + Tronscan), and an agentic AI assistant that can write/run scripts to fetch and import data.

## Architecture — What's Good

- **Contract-first approach** with OpenAPI specs driving generated types in both frontend and backend. Clean.
- **Provider pattern** for blockchain APIs is well-designed — `ProviderRegistry` with lazy init, shared rate limiter and cache. Adding new chains is trivial.
- **Agent loop** is tight: 10-iteration cap, repeat-tool guard, atomic save of assistant message + tool results in a transaction. The compaction beta for long conversations is smart.
- **Script execution sandbox** is the right call for batch blockchain work — way better than sequential tool calls. The harness pattern (async IIFE wrapping, stdin-based code injection) is solid.
- **Graph data model** — storing nodes/edges as JSONB per trace is a pragmatic choice. Avoids join hell for graph operations. The `importTransactions` endpoint with auto-node-creation and dedup is clean.
- **Frontend state management** — `useInvestigation` reducer with incremental Cytoscape sync is well-structured. The diff-based sync in `useCytoscape` (add/update/remove) is efficient.

## Security Issues

### 1. Script execution is not sandboxed enough
The child process has `fetch()`, which means it can hit *any* URL — including `localhost:8081` (the backend itself). An AI-generated script could `POST /cases` to create data, `DELETE /cases/:id` to destroy it, or hit internal services. The `API_URL` env var is explicitly provided for graph mutations, but there's nothing stopping scripts from doing other things.

**Fix:** Either whitelist allowed outbound domains (blockchain APIs only) or use actual process-level sandboxing (`--experimental-permission` flag in Node 20+).

### 2. No authentication on any endpoint
No auth middleware, no JWT, no session — everything is wide open. The `UsersModule` exists but there's no auth guard. Fine for local dev, but if this is going anywhere near a server, this is priority #1.

### 3. CORS is wide open
`enableCors()` with no origin restriction. Any origin can hit the API.

### 4. API keys exposed in SSE stream
AI scripts get raw API keys via env vars. The `tool_start` SSE event sends `input` which includes the `code` field — if the agent ever includes API key references in generated script code, those keys are visible to the client.

## Bugs

### 5. Tron timestamp handling is wrong
In `blockchain.service.ts`, timestamps are processed as `new Date(Number(tx.timeStamp) * 1000)` for all chains. But Tronscan returns timestamps in *milliseconds* already. Multiplying by 1000 again produces dates in the year ~65,000.

**Fix:**
```ts
const ts = chain === 'tron' ? Number(tx.timeStamp) : Number(tx.timeStamp) * 1000;
```

### 6. `handleSend` race condition in AIChat
When `activeConvId` is null, the component creates a conversation and calls `setActiveConvId`, but then immediately uses `activeConvId` (still null in the current closure) for the fetch URL. `POST /conversations/${activeConvId}/chat` hits `/conversations/null/chat`.

**Fix:**
```tsx
let convId = activeConvId;
if (!convId) {
  const conv = await apiClient.createConversation();
  convId = conv.id;
  // ...
}
// use convId for the fetch
```

### 7. SSE parsing assumes clean line boundaries
The `buf.split('\n')` approach in AIChat can split a multi-byte UTF-8 character across chunks. For an investigation tool with addresses/hashes this probably won't bite, but it's technically wrong.

### 8. `getAddressInfo` is dead code
Defined on the service but not exposed in the controller or OpenAPI spec. Either wire it up or remove it.

## Design Concerns

### 9. Conversations aren't scoped to cases
The data model has conversations as independent entities with no `case_id` FK. But the chat endpoint accepts `caseId` as a parameter. You can send `caseId=X` to a conversation originally used for `caseId=Y` and the agent will mix data from both cases.

**Fix:** Add a `case_id` column to conversations or validate the caseId matches the conversation's original context.

### 10. No error handling on SSE stream response
If `res.body` is null (network error, non-200 response), `res.body!.getReader()` crashes. Check the response status first.

### 11. `MAX_TOKENS = 4096` is tight for Opus with thinking
Adaptive thinking eats into the token budget. When the agent needs to reason about complex transaction patterns AND produce a detailed response with tool calls, 4096 might truncate. Consider 8192 or 16384.

### 12. Auto-save implementation unclear
The architecture doc mentions 1s debounce auto-save on state changes, but it's not visible in `useInvestigation`. If it's in a parent component, fine. If not implemented, that's a data loss risk.

### 13. `importTransactions` grid layout is naive
New nodes get placed in a linear grid starting at `maxX + 150`. For a large import (hundreds of addresses), this produces an unusable layout. Consider a force-directed layout pass after import, or at least a circular/radial arrangement.

## Code Quality

### 14. `.next/` and `tsconfig.tsbuildinfo` are committed
Add them to `.gitignore`. The `.next` directory alone is hundreds of cache files.

### 15. `backend/.env.development` is committed
Shouldn't be tracked regardless of whether it contains real keys.

### 16. Minor dead imports
`tool-definitions.ts` re-exports types that aren't used externally.

## Priority Order

If this is going to production or demo:

1. **Fix the Tron timestamp bug** (#5) — produces obviously broken dates
2. **Fix the handleSend race** (#6) — first-time users hit this immediately
3. **Add basic auth** (#2) — even a shared API key
4. **Restrict script fetch targets** (#1) — before any demo with real data
5. **Scope conversations to cases** (#9) — data integrity issue

## Verdict

The bones are good. Clean architecture, sensible patterns, well-documented. The main gaps are security hardening and a few bugs that'll surface immediately in real use.
