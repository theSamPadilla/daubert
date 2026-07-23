# To Do

## Active

## Deferred

- [ ] Blockchain API key hardening — backend proxy and/or per-case key issuance. See [`2026-04-27-blockchain-api-key-hardening.md`](./2026-04-27-blockchain-api-key-hardening.md). Accepted risk; revisit when moving to paid keys, multi-user abuse, or observed quota pressure.

## Advanced Search backlog

- [ ] Rate limit on `POST /traces/:id/search-between`. **Architectural decision needed**: the real shared resource is the Etherscan API budget across the whole backend, not per-case. Decide between per-case in-memory token bucket (band-aid) vs. centralized provider-side queue (deep fix) before coding.
- [ ] Component tests (RTL) for `SearchResults` (select-all + indeterminate checkbox state) and `WalletGroupPicker` (25-wallet cap enforcement). Frontend has zero tests for these components today.
- [ ] Surface `fetchedSide` in the results header (e.g., "Searched from Side A (8 wallets fetched)"). Minor UX polish; revisit only if an investigator asks.
