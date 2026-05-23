# Advanced Search — Follow-up Issues

> **Status:** Captured from the final `opus` code review of the Advanced Search feature (plan at `docs/plans/2026-05-23-advanced-transaction-search.md`). The 3 critical issues from that review were fixed before merge; the items below are the "significant" tier — meaningful UX/maintainability/latent-bug issues that didn't block shipping v1. Each is independent; cherry-pick or sequence as needed.

**Goal:** Close out the significant-tier issues from the v1 review so the feature is production-clean for multi-chain investigators.

**Architecture:** No new endpoints, no schema changes for most items. One backend ergonomics improvement (signal-through-request), one chain-aware address handling cleanup, optional rate limiting, and a small UX polish pass on the picker.

**Tech Stack:** Existing — no new dependencies.

---

## Atomized Changes (UX and DX)

| # | File / Surface | Action | Purpose |
|---|---|---|---|
| 1 | `frontend/src/components/AdvancedSearch/WalletGroupPicker.tsx` | Modify | Delete the picker-internal `useEffect` that clears value on chain change. Parent (`SearchPanel`) already clears it — remove the dual source of truth. |
| 2 | `frontend/src/components/AdvancedSearch/WalletGroupPicker.tsx` | Modify | `handleModeSwitch(next)` currently ignores `next`. Either preserve it as local state or initialise `value` with a sentinel so an empty wallets-mode picker can actually flip to group-mode. |
| 3 | `frontend/src/components/AdvancedSearch/WalletGroupPicker.tsx` | Modify | Disable the "By group" toggle button when `filteredGroups.length === 0` for the selected chain. Today it's clickable but the dropdown is empty. |
| 4 | `backend/src/modules/traces/traces.service.ts` (`resolveWalletSet`) | Modify | Stop unconditionally `addr.toLowerCase()`-ing addresses. Tron base58 is case-sensitive — current code corrupts Tron addresses. Make casing chain-aware: lowercase EVM (`0x…`), preserve Tron (`T…`). Apply the same rule wherever the search compares addresses (dedup keys, set membership). |
| 5 | `frontend/src/lib/api-client.ts` (the shared `request` wrapper) | Modify | Accept an optional `AbortSignal` parameter. Thread it through to `fetch(url, { ..., signal })`. |
| 6 | `frontend/src/components/AdvancedSearch/SearchPanel.tsx` | Modify | Pass the `AbortController.signal` from the panel's existing controller into `apiClient.searchBetween(...)`. Today the controller only blocks stale state writes; with signal threading, the underlying request also cancels. |
| 7 | `backend/src/modules/traces/traces.controller.ts` (or a guard/middleware) | Create / Modify | Per-case (or per-user) rate limit on `POST /traces/:id/search-between`. A search fires up to 25 parallel `fetchHistory` calls, sharing the global 5rps Etherscan budget. One malicious or sloppy member can starve other members of the same case. Light token bucket: e.g., max N searches per case per minute. |
| 8 | `frontend/src/components/AdvancedSearch/SearchResults.tsx` (`formatTimestamp`) | Modify | Drop the `isNaN(Number(ts))` branch — `BlockchainService` always returns ISO strings now. Heuristic is fragile and unused in practice. |
| 9 | `frontend/src/components/AdvancedSearch/__tests__/` | Create | Component tests (React Testing Library) for at minimum: `SearchResults` checkbox-select-all + indeterminate state, and `WalletGroupPicker`'s 25-wallet cap enforcement. Frontend has zero tests for the new components today. |
| 10 | `frontend/src/components/AdvancedSearch/SearchPanel.tsx` | Modify (small UX) | Surface `fetchedSide` somewhere subtle in the results header — e.g., "Searched from Side A (8 wallets fetched)." Useful for investigators wondering why a search took 8s vs 2s, and reinforces the smaller-side optimization isn't a black box. |

**User-visible outcome:** Multi-chain investigators (including Tron) can search reliably; closing the modal mid-search actually cancels the request; group-mode toggle no longer pretends to work when no groups exist on the chain; subtle "what just happened" feedback on which side was fetched.

**Developer-visible outcome:** One source of truth for picker reset; signal-aware `request()` wrapper opens the door for future cancellable calls anywhere; small but real test coverage for the new components.

---

## Engineering Decisions Made (defaults — override if needed)

- **Tron casing fix (#4):** detect chain via the chain key passed to the service (`'tron'` vs EVM). Don't try to detect from address format — too brittle.
- **Rate limit (#7):** start with a per-case in-memory token bucket (10 searches/min). If we ever get multi-instance backend, swap for Redis. Don't surface 429 separately — just treat as "search failed" with a friendly message.
- **Component tests (#9):** RTL only, no snapshot testing. Test behavior (clicks, state transitions) not markup.

---

## Sequencing recommendation

1. **First batch — UX/correctness, low risk:** #1, #2, #3, #8, #10. Tiny diffs, all frontend, no contract changes. Could be one PR.
2. **Second batch — request lifecycle:** #5 + #6. They go together; ship as one PR. Affects every API call in the codebase since the `request` wrapper is shared.
3. **Third batch — Tron correctness:** #4. Standalone but touches the search service. Needs careful test coverage — every `.toLowerCase()` in the search code path should be re-examined.
4. **Fourth batch — operational hardening:** #7 + #9. Rate limit + test coverage. Independent, can ship in parallel.

---

## Out of scope (still deferred from the v1 plan)

- **Async search mode** for groups larger than the 25-wallet sync cap.
- **1-hop / N-hop indirect search.**
- **Internal txs** (`txlistinternal`) inclusion.
- **Cross-chain search.**
- **Saved searches.**
- **Sub-groups / nested-group data model.**
- **Already-imported row disabling** in `SearchResults` — `importTransactions` dedups so re-import is a no-op; UX could be better but not v1.

## Commit policy

Per project convention: no commits unless the user explicitly says so. Each task here is small enough to be a single commit when finished.
