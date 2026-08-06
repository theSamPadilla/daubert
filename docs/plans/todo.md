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
- [x] **v2 — public `/external/trace` widget BTC support.** Shipped 2026-08-05 (cross-repo: backend DTO unfreeze + widget + chains section; plan doc since cleaned up).
- [ ] Provider scale path (operational, when BTC fetch volume grows): Blockstream Explorer API key (500k req/mo free) → mempool.space Pro → self-hosted electrs. Details: `docs/supported-chains.md` (Bitcoin scale path).
- [ ] Pre-existing dangling-edge authoring quirk, surfaced during the Solana-support ship: `frontend/src/hooks/useWalletTransactionAuthoring.ts` (~line 409) skips node creation for an empty-endpoint BTC row but still authors an edge whose endpoint resolves to `''` — tolerated (BTC's incoming multi-input rows legitimately carry an empty `from`), and made conspicuous by contrast with Solana's stricter row-level skip (an empty-endpoint Solana row skips the entire row, no dangling edge). Revisit.
- Explicitly out of scope until demanded: xpub wallet import, testnet, chain-wide clustering, taint apportionment in court-facing output, CoinJoin demixing, Ordinals/BRC-20/Runes, Lightning.

## Solana support backlog

Deferred from the Solana-support ship (2026-08-05; architecture in `docs/blockchain.md`, per-chain ops in `docs/supported-chains.md`).

- [x] Public `/external/trace` widget + website Solana support. Shipped 2026-08-05 (cross-repo, mirroring the BTC widget rollout: backend DTO unfreeze + per-transfer dedup + widget spam-row drop, website widget + chains/FAQ/mcp sections; plan doc since cleaned up).
- [ ] Spam-heuristic tuning. `KNOWN_MINTS` (`backend/src/modules/blockchain/sol/detect-spam.ts`) is deliberately small and hand-verified (USDC, USDT, wSOL only) — grow it, or integrate a verified-token list (e.g. Jupiter's token list) once real-case usage shows which majors are getting flagged `unknown-mint` that shouldn't be.
- [ ] Public widget: a spam-flooded Solana wallet can render an empty graph. The widget drops spam-flagged rows inside a fixed 40-row fetch window, so a wallet whose recent history is all airdrop spam returns "no activity" in the demo. Real fix is fetch-until-N-non-spam or a larger solana fetch window; both raise Helius credit burn per anonymous request, so decide alongside the Helius paid-tier item below.
- [ ] Helius paid tier (Developer, $49/mo for 10M credits) when sustained 429s or monthly credit exhaustion appear. Details: `docs/supported-chains.md` (Solana scale path).
- [ ] Pre-existing contract-paths gap, surfaced during this ship: `get-transaction` and `get-address-info` (`backend/src/modules/blockchain/blockchain.controller.ts`) are live NestJS routes with no corresponding declaration under `contracts/paths/` — only `fetch-history` is declared there. Predates Solana and applies to all chains; consider declaring both.
