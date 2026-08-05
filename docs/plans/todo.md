# To Do

## Active

## Deferred

- [ ] Blockchain API key hardening — backend proxy and/or per-case key issuance. See [`2026-04-27-blockchain-api-key-hardening.md`](./2026-04-27-blockchain-api-key-hardening.md). Accepted risk; revisit when moving to paid keys, multi-user abuse, or observed quota pressure.

## Advanced Search backlog

- [ ] Rate limit on `POST /traces/:id/search-between`. **Architectural decision needed**: the real shared resource is the Etherscan API budget across the whole backend, not per-case. Decide between per-case in-memory token bucket (band-aid) vs. centralized provider-side queue (deep fix) before coding.
- [ ] Component tests (RTL) for `SearchResults` (select-all + indeterminate checkbox state) and `WalletGroupPicker` (25-wallet cap enforcement). Frontend has zero tests for these components today.
- [ ] Surface `fetchedSide` in the results header (e.g., "Searched from Side A (8 wallets fetched)"). Minor UX polish; revisit only if an investigator asks.

## Bitcoin support backlog

Deferred from the Bitcoin-support ship (2026-08-04; working docs since cleaned up — architecture in `docs/blockchain.md`, per-chain ops in `docs/supported-chains.md`).

- [ ] **v1.1 — co-spend suggested-groups UI.** The evidence already ships on every edge (`UtxoContext`/`utxo.inputs[]`), so no schema work is needed — just a hook to detect shared-input co-spends across the working set, a suggestion panel, and an accept flow that dispatches `CREATE_GROUP`. Product decision: deferred to v1.1.
- [ ] Labeled-entities case-preserving display fix. `frontend/src/hooks/useLabeledEntities.ts` lowercases addresses (`wallet.toLowerCase()`) when building its cache map and on lookup — corrupts display/matching for case-sensitive Bitcoin (base58/bech32) and Tron addresses.
- [ ] EVM import-contract units mismatch. `frontend/src/hooks/useCaseSeed.ts`'s `mapFetchedTx` passes `tx.amount` straight through into `ImportTransactionItem.amount`, but for EVM chains that value is raw wei (from `EtherscanProvider`, not divided by decimals) while the import contract documents `amount` as human-readable. Renders as ~0 in the UI.
- [ ] `createGroup`'s remaining untrimmed address keys. `backend/src/modules/traces/traces.service.ts` ~208-215 (`newNodes` handling) still keys on `address.toLowerCase()` directly instead of the chain-aware `addressKey`/`normalizeAddressForChain` helpers `importTransactions` now uses — same class of bug as the fixed `importTransactions` case-collision bug.
- [ ] **v1.1 — "load more" expansion UX.** Ideation decision D5 was "top-N default + explicit load more"; what shipped is limit + date-range re-fetch only — no cursor-continuation control on a node. Needs a per-node "load older transactions" affordance that resumes the Esplora cursor (BTC) / page (EVM) where the last fetch stopped.
- [x] **v2 — public `/external/trace` widget BTC support.** DTO intentionally frozen rejecting non-EVM/Tron (`backend/src/modules/external-trace/dto/trace-query.dto.ts`); its incoming/outgoing direction-bucketing needs a UTXO redesign before BTC can be enabled. **Planned:** `../website-daubert/docs/plans/2026-08-05-btc-widget.md` (cross-repo: backend unfreeze + widget + chains section). — done in `../website-daubert/docs/plans/2026-08-05-btc-widget.md`
- [ ] Provider scale path (operational, when BTC fetch volume grows): Blockstream Explorer API key (500k req/mo free) → mempool.space Pro → self-hosted electrs. Details: `docs/supported-chains.md` (Bitcoin scale path).
- Explicitly out of scope until demanded: xpub wallet import, testnet, chain-wide clustering, taint apportionment in court-facing output, CoinJoin demixing, Ordinals/BRC-20/Runes, Lightning.
