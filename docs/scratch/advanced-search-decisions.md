# Advanced Search — Open Product Decisions

Surfaced during plan review on 2026-05-23. Plan: `docs/plans/2026-05-23-advanced-transaction-search.md`.

## Q1 — Cross-chain wallet sets

A trace can contain wallets on different chains (`node.chain` is per-node). The search endpoint takes a single `chain`. What happens when a user picks wallets across chains, or a group containing mixed-chain wallets?

- **(a) Filter the picker to one chain at a time.** User picks chain first; only matching nodes show. Single-chain search.
- **(b) Auto-derive chain per side; reject sides with mixed chains.** No chain selector — derived from picks. Error if mixed.
- **(c) Auto-split: run the search once per chain present in A ∪ B, merge results.** More provider calls, more cost.

Recommendation: **(a)**. Cross-chain "transactions between" doesn't exist as a real concept (bridges are intermediated, not direct). (c) burns budget for negligible value. (a) is the most predictable UX.

## Q2 — Internal transactions

Etherscan has a separate `txlistinternal` endpoint (currently unused) for contract-internal calls (e.g., a contract forwarding ETH to an EOA). Should "find transactions between A and B" include these?

- **(a) Skip — document as v1 limitation.** "Native + ERC-20 transfers only."
- **(b) Include — fetch internal txs alongside.** Doubles Etherscan calls per wallet (3 endpoints instead of 2: txlist, tokentx, txlistinternal). Real investigative value when a contract is the source/sink.
- **(c) Include behind a toggle.** "Include internal contract calls" checkbox, off by default.

Recommendation: **(a)**. Ship v1 without it; add in v2 if real searches miss things. The cost in provider budget and result noise (lots of internal txs are MEV/router internals) is non-trivial.

## Decided without asking (logged for review)

- **Q3 — Hash + token collisions in results:** Collapse rows to `(txHash, from, to)` (matches `importTransactions` dedup). If multiple tokens move in the same tx, show them as a comma-separated list on the row. Reason: otherwise the checkbox UX lies — selecting two rows creates one edge. Engineering call, not product.
- **Q4 — Contract creation rows:** Include them. `BlockchainService` already substitutes `contractAddress` for empty `to`. They're real txs an investigator may care about. Engineering call.
