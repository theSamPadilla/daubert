# QA: Bitcoin (UTXO) Support

Reference: `docs/blockchain.md` (architecture), `docs/supported-chains.md` (providers/ops).

**What shipped:** Bitcoin as a sixth chain — Esplora-backed provider (mempool.space, blockstream.info failover), UTXO rich edges carrying `inputs[]`/`outputs[]`/`fee`, tx-junction nodes for high fan-in/out transactions, change-output flags with cited evidence, CoinJoin/consolidation warnings, BTC-aware fetch/staging UX, AI-agent skill + import contract, MCP tools.

**Status (2026-08-05):** Browser QA run complete, all 3 failures fixed and re-verified in-browser. **33 PASS · 0 FAIL · 2 post-deploy.**
**Verdict: ship.** Only the post-deploy MCP checks remain. Fix plan: `docs/plans/2026-08-05-btc-qa-fixes.md` (applied, working tree, uncommitted).

The evidentiary core is sound — everywhere the design promised not to invent facts, it doesn't: senders never synthesized (3.5), junctions carry the ledger verbatim (4.2), coinbase renders as "Coinbase" not a fake payer (4.4), aggregated edges never show one tx's UTXO next to a summed amount (5.2), change verdicts are labeled inferences with cited evidence (2.2), dedup holds across fetch subjects (3.3), chains/utxo payloads survive reload untouched (10.2).

---

## Outstanding

### Post-deploy — MCP against prod (Sam runs after deployment)

The MCP tasks could not be tested live: the local `/mcp` endpoint requires OAuth and the connected MCP server targets the deployed instance, so exercising it pre-deploy would have tested the *old* prod build. This build's `blockchain-tools.spec.ts` passes 19/19 covering exactly these assertions — but that is not live verification. After deploying, run from any MCP client (e.g. claude.ai Daubert connector):

- [ ] **8.1 — `blockchain_fetch_history` summarizes UTXO**
  Call with `chain: "bitcoin"`, `address: bc1q2w9xxf9wf7cvgepsxp83qg9x0a7fcfyx9mxuxr` (7 lifetime txs).
  ✔ Rows carry **summarized** utxo — counts / fee / warnings only, never full `inputs[]`/`outputs[]` arrays.
  ✔ Returns 7 rows (never zero when data exists).
- [ ] **8.2 — `blockchain_get_transaction` full vs clamped**
  Normal txid `605531c5ab963726595f4db3323c133a35222e9309a098ce02f39fdfc071e44c` (1-in/2-out):
  ✔ **full** utxo — complete inputs/outputs arrays, fee 705, block 958,799.
  Huge txid (>100 combined ins+outs — fetch history for `bc1qrt0ws8s6zt9dsg8nv6ht89sfrg5hnqklv6w9pw` around 2026-08-03/04 and take a `2 in / 132 out` or `5 in / 98 out` junction row's txid):
  ✔ **clamped** to a count-only summary, no full arrays.

---

## Fixed & re-verified (2026-08-05, second browser run)

All three failures were fixed via `docs/plans/2026-08-05-btc-qa-fixes.md` and re-driven in the browser. Frontend 364/364 tests, `tsc --noEmit` clean, backend 1382/1382.

| Id | Before | After (browser-verified) |
|---|---|---|
| **5.1** ✅ | canvas `0 BTC (3)`; panel total `0.03 BTC`; rows `0.01 / 0.01 / 0.02` | canvas **`0.0273 BTC (3)`**; panel total **`0.0273 BTC`**; rows **`0.0051 / 0.0062 / 0.0159`**. Other aggregated labels now read `0.0026 BTC`, `0.0051 BTC` (all three were `0 BTC` before) |
| **1.5** ✅ | `tr7nhqje…` persisted, dead tronscan link | `TGzgVdQszcAHbEd9VELwifASLRdQY9kTcx` case-intact in panel, explorer URL, **and Postgres**. Regressions clean: EVM still lowercases (`0x742d35cc…`), BTC base58 still preserved |
| **6.2** ✅ | 140 picker rows incl. 6 junction entries; selecting one sent a txid and surfaced a raw regex | **134 rows, zero junctions** (exactly the 3 junctions × 2 sides removed). Address free-text mode now rejects both a txid and an EVM-address-on-Bitcoin with **"bitcoin requires a base58 (1…/3…) or bech32 (bc1…) address"** — no raw regex. Search happy path intact (returned `605531c5…`, 1,546,373 sats) |

Beyond the three, the fix round also corrected a **formatter disagreement the original QA missed**: `formatTokenAmount` truncates while the new `formatHumanAmount` initially rounded, so the same transaction read `0.0273` on a plain edge but `0.0274` when its group was collapsed. Both now truncate. It also stopped sub-1e-8 18-decimal (ERC-20) aggregates rendering as `0` — the same defect as 5.1, which the first implementation would have moved from BTC to EVM.

<details>
<summary>Original failure details (for reference)</summary>

### 5.1 — Aggregated BTC amounts lose precision (canvas label reads "0 BTC")

Grouping/collapsing/re-routing all work, and 5.2 (no single-tx UTXO on synthetic edges) **passes** — but aggregated amounts are formatted for whole-token values, not BTC's 8 decimals:

| Surface | Shows | Should be |
|---|---|---|
| Canvas aggregated edge label | **`0 BTC (3)`** | `0.0274 BTC (3)` |
| Panel → Total amount | `0.03 BTC` | `0.0274 BTC` |
| Panel → per-tx rows | `0.01`, `0.01`, `0.02 BTC` | `0.0051`, `0.0062`, `0.016` |

**Repro:** BTC trace → select 2 wallet nodes → *Group within trace* → Create → click group → **Collapse** → read the aggregated edge label, then click the edge.
**Cause:** three human-float formatters capped at 1–2 fraction digits — `cytoscapeSync.ts:144`, `MultiTxDetails.tsx:49`, `GroupDetails.tsx:12`. Pre-existing helpers; BTC's sub-1 amounts newly route through them. `formatTokenAmount` already handles sub-0.0001 correctly (why 3.1 passes) — the aggregation paths just don't use it.
**Re-verify:** collapsed BTC group's edge shows `0.0114 BTC (2)`-style precision; panel totals match.

### 1.5 — Tron address lowercased on the manual-create path

EVM and BTC behave correctly; auto-chain detection correct for all families. But a manually-created Tron node persists lowercased — corrupting a case-sensitive base58check address and producing a dead tronscan link. The node *label* keeps original casing, so the corruption is invisible on canvas.

**Repro:** Quick Add → paste `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` → chain auto-selects `tron` → Save → details panel shows `tr7nhqje…` with a broken explorer link.
**Cause:** `useWalletTransactionAuthoring.ts:54/86/209` — `chain === 'bitcoin' ? normalizeAddressForChain(...) : raw.toLowerCase()`. The shared normalizer already preserves Tron; the BTC work carved out Bitcoin and left Tron on the blanket lowercase.
**Scope:** pre-existing (pre-change line was an unconditional `.toLowerCase()`), confined to manual create — the 35 Tron nodes in the Geffen case (fetch/import path) are all correctly cased. Existing corrupted nodes are unrecoverable (casing information is lost); no migration.
**Re-verify:** repro above shows mixed case + working tronscan link.

### 6.2 — Junction nodes offered as search wallets; txid sent as an address

The picker's "By wallets" mode lists `txJunction` nodes (`10 in / 2 out fa2930…b2c2`, etc.). Selecting one sends the **txid in the `wallets` array**; the backend rejects with 400 on the address regex — so no bad data enters the graph and nothing reaches `failedAddresses` — but the search fails and the user sees the raw validation regex as the error.

**Repro:** open a junction-bearing trace → Search → Side A: tick a junction row → Side B: any wallet → Search.
**Cause:** `WalletGroupPicker.tsx:62-70` builds `allChainNodes` with no `kind` filter. The backend's `resolveWalletSet` already filters `txJunction` on trace/group expansion — only the client wallet-list path is exposed.
**Re-verify:** junction rows absent from the picker in both Side A and Side B; trace/group mode unaffected.

</details>

---

## Completed tasks — evidence log (2026-08-05 run)

### 1. Chain registry & address forms
- ✅ **1.1** Bitcoin listed in all three chain dropdowns (6 chains, consistent order).
- ✅ **1.2** `bc1q…` / `1A1z…` / `3…` all auto-select Bitcoin; label auto-fills truncated.
- ✅ **1.3** Explorer link → `mempool.space/address/<addr>`.
- ✅ **1.4** Base58 casing preserved in persisted node (verified in Postgres, not just UI).
- ✅ **1.5** EVM lowercased, BTC preserved, **Tron preserved** (fixed + re-verified in browser and Postgres).

### 2. Fetch history flow
- ✅ **2.1** BTC modal hides Start/End Block (EVM keeps them); date range + limit kept.
- ✅ **2.2** Direction pills, "N in / M out" chips, amber **change?** badges with `title="address reuse"` evidence, junction chips.
- ✅ **2.3** 33 found · 18 selected — all 15 change rows unchecked; select-all skips them; manual click selects.
- ✅ **2.4** Date window returns exactly the in-range txs; empty range → clean "No transactions found."
- ✅ **2.5** Re-fetch: "7 found · 0 new · 7 already in graph".
- ✅ **2.6** EVM fetch table unchanged — no Info column, no badges.

### 3. Graph: direct edges and junction nodes
- ✅ **3.1** Full 8-decimal precision: 6,000 sats → `0.00006`, 547 sats → `0.00000547`; fees likewise.
- ✅ **3.2** Slate rectangle "40 in / 1 out"; 41/12 legs exact; explorer → `mempool.space/tx/<txid>`.
- ✅ **3.3** No duplicates — same tx re-fetched from a *different participant* still recognized (`txid:vout` identity); counts unchanged.
- ✅ **3.4** Junction menu: only Attach label + Delete (wallet menu contrast confirmed).
- ✅ **3.5** Multi-input incoming rows: blank FROM + junction — sender never guessed (code rule verified: `from` only when exactly 1 decodable input).

### 4. Details panels
- ✅ **4.1** Direct edge: full UTXO section, fee/status/inputs/outputs, own output highlighted (`bg-brand/10`).
- ✅ **4.2** Junction panel: txid + copy + explorer, Consolidation/Multi-input chips, fee, full tables, counts.
- ✅ **4.3** Leg edge: compact "Part of transaction … input leg #3" only.
- ✅ **4.4** Coinbase: "Coinbase" chip, input rendered as "Coinbase" (data: `address: null, coinbase: true`), OP_RETURN labeled.

### 5. Groups, aggregation, bundles
- ✅ **5.1** Group/collapse/re-route work; aggregated amounts now full-precision and truncation-consistent with plain edges (fixed + re-verified).
- ✅ **5.2** Aggregated edge panel: totals + count + date span + constituent txids, **no single-tx UTXO** — the critical evidentiary check holds.

### 6. Advanced search
- ✅ **6.1** BTC search-between returns the exact known tx; import survives hard reload (edge ids identical, 7/7 utxo intact, group collapsed state kept — no lost update).
- ✅ **6.2** Junctions no longer offered in the picker (134 rows, was 140); Address mode rejects txids/wrong-chain with a friendly message (fixed + re-verified).

### 7. AI agent
- ✅ **7.1** Agent loaded `bitcoin-apis` skill, ran mempool.space script (no sandbox domain block), imported +1 node/+1 edge with full UTXO payload (fee 4,234 matches ledger); correctly explained single-input attribution.
- ✅ **7.2** Agent identifies `txJunction` kind (3), describes junctions via UTXO summaries (counts/fee/blocks) not raw arrays; all values matched DB + mempool.space. *Minor prose imprecision only: called a 2-input tx a "consolidation".*

### 8. MCP tools
- ⏳ **8.1 / 8.2** Deferred to post-deploy (see Outstanding). Unit coverage on this build: `blockchain-tools.spec.ts` 19/19 — summarize-to-counts, clamp >100, never-zero-rows, full-utxo-untouched, chain "bitcoin" accepted.

### 9. Guards & edge cases
- ✅ **9.1** Txid/tx-URL paste into Quick Add blocked with the no-single-sender message; no edge created.
- ✅ **9.2** Seed step: BTC auto-derives; imported "7 transactions across 6 wallets" (exact); BTC+EVM mix blocked with one-chain-per-seed error.
- ✅ **9.3** Mixed-case bech32 `bc1Q…` rejected ("Invalid", button disabled).
- ✅ **9.4** `/external/trace?chain=bitcoin` → 400 (intentional); EVM control 200.

### 10. Exports & persistence
- ✅ **10.1** PNG export renders all junctions (rectangles, labels, legs, amounts).
- ✅ **10.2** Hard reload: 66/66 nodes, 61/61 edges, junction kind+chain intact, addresses byte-identical, 61/61 utxo payloads kept.
- ✅ **10.3** Pre-existing Tron investigation (Geffen) renders exactly as before; its 35 Tron addresses correctly cased.

---

## Noted, not outstanding

- **Dangling edges from address-less outputs:** bare `multisig` outputs (Esplora `scriptpubkey_address: null`, not OP_RETURN) produce edges with empty `to` (tx `abb67607…8bf5` vouts 1–2). No phantom node minted, Cytoscape silently drops them — but they persist in the trace JSONB (stored 68 edges vs 66 renderable), and the divergence propagates to the agent/exports. Not a fabrication; needs a design call (render as unattributed junction-style sink vs. filter at map time). Tracked separately, not part of the fix plan.
- **`frontend/src/utils/importData.ts`** has the same unconditional-lowercase pattern as 1.5, but is dead code (zero call sites) — out of scope.
- **`GET /blockchain/get-address-info` 500s for EVM/Tron** (Etherscan "Missing Or invalid Action name"; Tronscan 400): pre-existing enrichment-path issues in untouched provider files, not BTC regressions. Fetch-history works for both chains (2.6).

## Test data (for re-runs, verified against mempool.space at tip 961192)

| Role | Value |
|---|---|
| Low-activity bech32 (7 txs) | `bc1q2w9xxf9wf7cvgepsxp83qg9x0a7fcfyx9mxuxr` |
| Junction address (2 multi-input txs) | `bc1qzp32n5nhymhdf2x0t5fyreps3vnu9qjspue8ac` |
| Consolidation tx (40-in/1-out) | `c4b2c45d8f73085da8b6b9d37d29dd304d344a4dca58a2ceaa6e1e5356031db8` |
| Second junction (10-in/2-out) | `fa29302d52723995cbfe30f35a767837c736d06645ee3ba4395efa440ac7b2c2` |
| Address-reuse change source (~200 txs) | `bc1qrt0ws8s6zt9dsg8nv6ht89sfrg5hnqklv6w9pw` |
| Coinbase tx / pool address | `f6638ff9d0a8f0f985b600cb0ce91adc74001883d7da7733006f642410b2dbba` → `bc1qwzrryqr3ja8w7hnja2spmkgfdcgvqwp5swz4af4ngsjecfz0w0pqud7k38` |
| Small-amount address (sub-0.0001 rows) | `bc1q9q7fduffcphmedf6502v6x02ulg25u28kfm9v9` |
| Simple direct-edge tx (1-in/2-out) | `605531c5ab963726595f4db3323c133a35222e9309a098ce02f39fdfc071e44c` |
| Genesis P2PKH (case test) | `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` |

## Intentional behaviors — do NOT report as bugs

- Change rows unchecked by default in fetch/staging; analyst can check them manually.
- StagingPanel shows no direction pill (no fetched-address context there), only count/change/junction badges.
- `blockchain_get_transaction` / transaction detail's top-level `from`/`to` for BTC are *representative* (first input / largest non-change output) — the utxo payload is the ledger truth.
- Co-spend suggested-groups UI is deferred to v1.1 (`docs/plans/todo.md`); manual grouping works.
- Public `/external/trace` widget rejects Bitcoin (deferred to v2).
- The 13 backend e2e failures (missing live OAuth/DB fixtures).
- Fetches of very active addresses are slow (~3 req/s budget, 25 txs/page upstream) — use small limits and date bounds.
