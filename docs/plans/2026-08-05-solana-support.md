# Solana Support Implementation Plan

**Goal:** Add Solana as a first-class traced chain — Helius-backed provider (parsed transfers, owner wallets resolved), native SOL + SPL token rows on the existing scalar edge model, visible spam flagging with evidence — across fetch/staging, canvas, reports, AI agent, and MCP.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `shared/chains.ts` | Modify | Solana appears in every chain dropdown, MCP enum, and explorer-link builder |
| 2 | `shared/address.ts` | Modify | Solana addresses validate/normalize; BTC-vs-Solana base58 ambiguity gets an explicit precedence rule |
| 3 | `shared/edge-identity.ts` | Modify | Multi-transfer Solana txs dedup per transfer, not per tx |
| 4 | `backend/src/config/env.validation.ts`, `backend/.env.example` | Modify | `HELIUS_API_KEY` required at boot, documented |
| 5 | `backend/src/modules/blockchain/helius-client.ts` (+spec) | Create | Helius HTTP client: parsed history, tx parse, mint metadata, balance — own rate limiter + cache |
| 6 | `backend/src/modules/blockchain/solana-provider.ts` | Create | `SolanaProvider` seam (cursor pagination — mirrors the UTXO seam decision) |
| 7 | `backend/src/modules/blockchain/helius.provider.ts` (+spec) | Create | Cursor-paginated history with date-stop, mint-metadata resolution |
| 8 | `backend/src/modules/blockchain/provider-registry.ts` | Modify | `getSolana()` routing; `get('solana')` fails loudly |
| 9 | `backend/src/modules/blockchain/sol/detect-spam.ts` (+spec) | Create | Spam/dust airdrop heuristics with cited evidence (product decision B) |
| 10 | `backend/src/modules/blockchain/sol/map-solana-history.ts` (+spec) | Create | Parsed txs → TransactionResult rows (units, direction, transferIndex, spam flags) |
| 11 | `backend/src/modules/blockchain/blockchain.service.ts` | Modify | `chain === 'solana'` branch in fetchHistory/getTransaction/getAddressInfo; `SolanaContext` type |
| 12 | `contracts/schemas/blockchain.yaml`, `contracts/schemas/traces.yaml` | Modify | `solana` context on TransactionResult + ImportTransactionItem |
| 13 | `backend/src/modules/traces/dto/import-transactions.dto.ts` (+spec) | Modify | `SolanaContextDto` survives whitelist ValidationPipe (canary test) |
| 14 | `backend/src/modules/mcp/tools/write-tools.ts` (+spec) | Modify | zod `solana` strictObject on import items |
| 15 | `backend/src/modules/ai/investigation-data.utils.ts` (+spec) | Modify | Agent sees the (bounded) `solana` context on edges |
| 16 | `backend/src/modules/traces/traces.service.ts` (+spec) | Modify | Import: token-object expansion from context; searchBetween solana cap |
| 17 | `frontend/src/utils/addressParser.ts` (+test) | Modify | Solana address/signature/solscan-URL detection with BTC-precedence rule |
| 18 | `frontend/src/components/Graph/ChainSelect.tsx` | Modify | `NetworkSolana` icon |
| 19 | `frontend/src/utils/classifySolanaRow.ts` (+test) | Create | Direction + spam classification for staging rows |
| 20 | `frontend/src/components/Workspace/FetchModal.tsx`, `frontend/src/components/Graph/StagingPanel.tsx` | Modify | Spam badge + evidence tooltip; spam rows unchecked by default; solana fetch options |
| 21 | `frontend/src/types/investigation.ts`, `frontend/src/hooks/useInvestigation.ts` (+test) | Modify | `solana` on TransactionEdge; aggregates never inherit it |
| 22 | `frontend/src/hooks/useWalletTransactionAuthoring.ts`, `frontend/src/hooks/useCaseSeed.ts`, `frontend/src/components/Onboarding/CaseOnboardingWizard.tsx` | Modify | Staged solana rows author edges with context; wizard/seed treat solana fetch options like bitcoin |
| 23 | `frontend/src/components/Graph/details/TransactionDetails.tsx` | Modify | Solana drill-down: fee payer, program, mint, spam evidence |
| 24 | `backend/src/skills/solana-apis.md` | Create | AI skill: Helius endpoints, units, spam semantics, import example |
| 25 | `backend/src/skills/graph-mutations.md` | Modify | Solana chain docs + import example; fix stale chain list in group docs |
| 26 | `backend/src/modules/ai/services/script-execution.service.ts` | Modify | Sandbox allows Helius host; key injected server-side |
| 27 | `docs/supported-chains.md`, `docs/blockchain.md`, `docs/plans/todo.md` | Modify | Ops + architecture docs; deferred items recorded |

## Summary

- **What & why:** Daubert traces 4 EVM chains, Tron, and Bitcoin. Solana is where memecoin fraud, drainer campaigns, and a growing share of stablecoin flows live — and it's account-model, so transfers are genuine `from → to → amount` facts that fit the existing scalar edge model. No junction nodes, no change heuristics, no UTXO-scale schema work. The BTC ship already generalized the chain registry, address module, edge identity, cursor-pagination provider pattern, and `maxTotal` plumbing — this plan mostly instantiates those seams for a new chain.
- **Key product decisions (locked in conversation, 2026-08-05):**
  - **Provider: Helius** Enhanced Transactions API — parsed transfers with owner wallets resolved (the ATA problem solved upstream), signature-cursor pagination. `HELIUS_API_KEY` required at boot like the Etherscan/Tronscan keys. Free tier to start (1M credits/mo, 100 credits/history page, 2 req/s Enhanced).
  - **Spam posture (Option B): fetch everything, flag suspected spam with evidence, default-uncheck in staging.** Exact mirror of the BTC change-output treatment — nothing silently hidden, investigator decides.
  - **Scope: native SOL + SPL tokens in.** NFTs/cNFTs, staking decoding, DeFi position parsing out until a case demands them.
  - **Public `/external/trace` widget + website: deferred**, same rollout order as BTC (core first, widget as a separate cross-repo plan later). The widget DTO's hand-maintained chain list intentionally stays at 6 chains; noted in `todo.md`.
- **Load-bearing architecture decisions:**
  - **`SolanaProvider` is a third provider seam** (`getSolana()`), mirroring the UTXO seam — Helius paginates by signature cursor, which cannot implement the page-number `BlockchainProvider` contract. `BlockchainService` short-circuits on `chain === 'solana'` exactly like the bitcoin branches. EVM/Tron paths untouched. Unify the seams only if a fourth cursor-paginated family ever appears.
  - **Edge identity per transfer:** one Solana tx can carry several transfers (swap legs, batch payouts). Identity = `${signature}:sol:${transferIndex}` via a new `edgeIdentityKey` branch; `transferIndex` is the position in Helius's deterministic `[...nativeTransfers, ...tokenTransfers]` concatenation.
  - **`SolanaContext` is the bounded per-row payload** (feePayer, mint, decimals, token accounts, spam + evidence — scalars only, no arrays of arrays) and must be declared at all four whitelist sites (import DTO `implements` pattern, contracts YAML, MCP zod strictObject, stripTraceForAgent) or it is silently stripped — the exact lesson the BTC `utxo` payload taught.
  - **BTC-precedence rule for ambiguous base58:** Solana addresses have no prefix, so a 32–34-char base58 string starting with `1`/`3` matches both the BTC and Solana shapes. Auto-detection tries BTC first (a real Solana address that short requires ~5 leading zero bytes — astronomically rare); chain-explicit validation (dropdown selected) accepts the full Solana window regardless, so users are never blocked. `ADDRESS_RE`'s "mutually exclusive prefixes" doc comment gets rewritten to document this.
- **Opus-tagged tasks (risk concentrates here):** T7 (`mapSolanaHistory` normalizer — units, direction, identity), T9 (four-schema lock-step).
- **Boot-breaking change to know about:** after this plan lands, the backend refuses to start without `HELIUS_API_KEY` in the environment. Provision the key (instructions delivered separately) before running dev or deploying.

## Engineering decisions made (log; override if wrong)

- **Units:** fetch path produces **raw base units** + token object — native SOL: lamports + `{address:'', symbol:'SOL', decimals:9}`; SPL: raw token units + `{address: mint, symbol, decimals}` (mirrors EVM raw-wei and BTC sats conventions). Helius reports `tokenTransfers[].tokenAmount` decimal-adjusted, so the normalizer converts decimal→raw via **string math** (`decimalToRaw` helper — no float multiplication). Bare AI imports (no `solana` context) keep human-readable amounts + string token, same as every other chain.
- **Mint metadata:** symbol/decimals resolved per mint via Helius DAS `getAsset`/`getAssetBatch`, cached 24h (same TTL as EVM token metadata). Fallback when metadata is missing: symbol = first 4 chars of mint + `…`, decimals from the transfer's raw token amount object when present, else 0 — and `unknown-mint` becomes spam evidence.
- **Spam heuristic (MVP):** `spam: true` when `unsolicited` (address is a recipient, not a sender, and not the fee payer) AND (`unknown-mint` OR `mass-distribution` (≥10 token transfers to distinct recipients in one tx)). Evidence array always populated; never fires on native SOL rows or on outgoing rows. Known-mint allowlist is a small hardcoded map (USDC, USDT, wSOL + a few majors), each address verified against solscan during implementation — do not trust memory for mint addresses.
- **Failed txs** (`transactionError != null`) are skipped in history (no value moved); zero-amount transfers skipped; transfers not touching the fetched address skipped. Self-transfers kept (`from === to`), consistent with BTC self-send.
- **`timestamp`** = Helius unix seconds → ISO; **`blockNumber`** = `slot`.
- **Rate budget:** dedicated `RateLimiter(2, 2)` + dedicated `ResponseCache` in `HeliusClient` — the dedicated-instance pattern from `EsploraClient` (which itself runs `(3, 3)`; Helius gets `(2, 2)` because its free-tier Enhanced limit is exactly 2 req/s — don't copy Esplora's numbers). On HTTP 429 the client waits 600ms and retries once (no failover host — single provider). Never share the EVM/Tron cache.
- **`usesCursorPagination(chain)` shared predicate** (family-derived, exported from `shared/chains.ts` in Task 1) replaces the inline `chain === 'bitcoin'` fetch-option checks that were about to be open-coded a fifth time across FetchModal (4 sites) and useCaseSeed — one edit site for the next cursor-paginated chain.
- **`searchBetween` cap:** solana → `maxTotal: 300` (3 pages), slotted into the existing chain ternary next to bitcoin's 300.
- **Signature detection:** Solana tx signatures are ~87–88-char base58. Bare-string detection only classifies solana-tx at length 80–88 (a 64-char hex string is also valid base58, so the existing "bare 64-hex stays EVM" rule is preserved — regression-locked). Solscan/explorer.solana.com URLs are the unambiguous path.
- **`stripTraceForAgent` passes the `solana` context through as-is** — unlike `utxo` it is bounded (~10 scalar fields), so no summarization layer.
- **Token-object expansion on import:** `SolanaContext` carries `mint` + `decimals` so `traces.service.ts` can rebuild the token object from the wire-format string token (the `btcToken()` precedent, but per-mint). Rows with `solana` context = raw base units; bare rows = human amounts.
- **Generic `edgeIdentityKey` lowercase fallback** stays as-is for context-less solana rows — the same latent case-fold quirk Tron already has; a case-fold base58 collision is astronomically unlikely. Not worth a breaking key change.
- **`chainId: 0`** for solana (like bitcoin — the numeric id is only consumed by Etherscan). Explorer: solscan.io with `/account/` + `/tx/` paths.
- **No migrations:** trace data is JSONB (additive `solana` field only); no entity columns change. The env-var addition is config, not schema.

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task. Never commit unless the user explicitly says to. Run `git status` at the end of each task.

## Execution rules

- TDD per task: write the failing test, run it, implement, re-run green.
- Commands: backend `npm run test --prefix backend`, frontend `npm run test --prefix frontend`, codegen `npm run gen` (regenerates api-types AND re-copies `shared/` into both `src/generated/shared/` — required after every `shared/` or `contracts/` change; never edit generated copies).
- Builds stay green at phase boundaries: `npm run build --prefix backend`, `npm run build --prefix frontend`.
- **Backend boot in dev will fail after Task 4 until `HELIUS_API_KEY` is set** — for local verification, any non-empty placeholder passes env validation; real fetches need the real key.
- No commits. `git status` at end of each task.

## Phase 1 — Registry, address family, edge identity

### Task 1: Solana in `shared/chains.ts` + `shared/address.ts`
**Implementer:** sonnet
**Files:** Modify `shared/chains.ts` · Modify `shared/address.ts` · Extend `frontend/src/utils/chains.test.ts`, `frontend/src/utils/address.test.ts` (they import the generated copies) · Modify `backend/src/modules/blockchain/types.spec.ts` (its `CHAIN_CONFIGS` assertion hardcodes "exactly the 6 registry chains" at ~lines 8-13 — update to 7 or it goes red) · `npm run gen`
- `shared/chains.ts`: extend `ChainFamily` with `'solana'`; add:
```ts
solana: { id:'solana', name:'Solana', family:'solana', chainId:0, nativeCurrency:{symbol:'SOL',decimals:9}, explorerUrl:'https://solscan.io', addressPath:'/account/', txPath:'/tx/', caseSensitiveAddresses:true },
```
- Also export the shared pagination predicate (Tasks 12/13 consume it — do not let them open-code the boolean per call site):
```ts
/** Chains whose providers paginate by cursor — no block-range or page/offset params. */
export function usesCursorPagination(chain: string): boolean {
  const f = CHAINS[chain]?.family;
  return f === 'utxo' || f === 'solana';
}
```
- `shared/address.ts`:
```ts
/** Solana base58-encoded 32-byte pubkey. No prefix — see the ambiguity note on ADDRESS_RE. Case-sensitive. */
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isSolanaAddress(addr: string): boolean { return SOLANA_ADDRESS_RE.test(addr); }
```
  - Extend `ADDRESS_RE` with the solana alternative. **Rewrite its doc comment**: prefixes are no longer mutually exclusive — a 32–34-char base58 string starting with `1`/`3` matches both BTC and Solana shapes; auto-detection resolves BTC-first (document why: a Solana pubkey that short needs ~5 leading zero bytes), chain-explicit validation is unaffected.
  - `isValidAddress` += `isSolanaAddress`. `validateAddressForChain`: `chain === 'solana'` branch (message: `solana requires a base58 address (32-44 chars)`). `normalizeAddressForChain` needs **no change** (only EVM lowercases) — add a test locking that solana preserves case.
- Tests: registry has 7 chains; `usesCursorPagination` true for bitcoin + solana, false for ethereum/tron; `explorerAddressUrl('solana', a)` → `https://solscan.io/account/…`, `explorerTxUrl` → `/tx/…`; USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` and a wallet address validate as solana; a 44-char base58 fails `validateAddressForChain(addr,'bitcoin')`; genesis BTC address still valid as bitcoin AND matches `SOLANA_ADDRESS_RE` (document the overlap in the test — this is expected); Tron/EVM regression; search-between DTO (`@Matches(ADDRESS_RE)`) accepts a solana address after regen.

### Task 2: `edgeIdentityKey` solana branch + `SolanaContext` type
**Implementer:** sonnet
**Files:** Modify `shared/edge-identity.ts` · Modify `backend/src/modules/blockchain/types.ts` (define `SolanaContext`) · Extend `frontend/src/utils/edgeIdentity.test.ts` · `npm run gen`
- `shared/edge-identity.ts`: `EdgeIdentity` gains `solana?: { transferIndex?: number }`; before the generic fallback:
```ts
if (e.chain === 'solana' && e.solana?.transferIndex != null) return `${e.txHash}:sol:${e.solana.transferIndex}`;
```
- `types.ts` — the bounded per-row context (scalars only; `spamEvidence` is the only array, of short strings):
```ts
export interface SolanaContext {
  transferIndex: number;            // position in [...nativeTransfers, ...tokenTransfers] — edge identity
  feePayer: string;
  kind: 'native' | 'spl';
  mint?: string;                    // spl only
  decimals?: number;                // spl only (native SOL is 9, implied by token object)
  fromTokenAccount?: string;        // spl only — raw token accounts, evidentiary
  toTokenAccount?: string;
  type?: string;                    // Helius tx type (TRANSFER, SWAP, ...)
  source?: string;                  // Helius source program (JUPITER, ...)
  slot?: number;
  spam?: boolean;
  spamEvidence?: string[];          // e.g. ['unsolicited','unknown-mint']
}
```
- Tests: two transfers in one signature produce distinct keys; same transfer twice dedups; BTC branch regression; context-less solana row falls back to the generic key.

### Task 3: Registry guard + chain icon
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/blockchain/provider-registry.ts` (in `get()`, next to the bitcoin guard: `if (chainId === 'solana') throw new Error('solana uses the Solana provider path (getSolana)')` — closes the transient window where `get('solana')` would construct an EtherscanProvider before Task 8 adds real routing) · Modify `frontend/src/components/Graph/ChainSelect.tsx` (`import { NetworkSolana } from '@web3icons/react'` — verified present; `CHAIN_ICON_MAP` += `solana: NetworkSolana`)
- No other frontend list work: `QuickAddInput` `CHAIN_OPTIONS = CHAIN_IDS` and `frontend/src/services/types.ts` `SUPPORTED_CHAINS` both derive from the registry automatically.
- Tests: registry spec — `get('solana')` throws the guard message; existing suites green (dropdowns now list Solana via derivation).

## Phase 2 — Provider

### Task 4: `HELIUS_API_KEY` + `HeliusClient`
**Implementer:** sonnet
**Files:** Modify `backend/src/config/env.validation.ts` (`requiredEnvVars` += `'HELIUS_API_KEY'`) · Modify `backend/.env.example` (add `HELIUS_API_KEY=your-helius-api-key` beside the other keys) · Create `backend/src/modules/blockchain/helius-client.ts`, `backend/src/modules/blockchain/helius-client.spec.ts`
- Typed Helius shapes (subset consumed):
```ts
export interface HeliusNativeTransfer { fromUserAccount: string | null; toUserAccount: string | null; amount: number } // lamports
export interface HeliusTokenTransfer {
  fromUserAccount: string | null; toUserAccount: string | null;
  fromTokenAccount: string | null; toTokenAccount: string | null;
  mint: string; tokenAmount: number; tokenStandard?: string;      // tokenAmount is DECIMAL-ADJUSTED
}
export interface HeliusParsedTx {
  signature: string; timestamp: number; slot: number; fee: number; feePayer: string;
  type: string; source: string; description?: string;
  nativeTransfers: HeliusNativeTransfer[]; tokenTransfers: HeliusTokenTransfer[];
  transactionError: unknown | null;
}
export interface MintMetadata { mint: string; symbol: string; decimals: number }
```
- Constructor: `(apiKey: string, host = 'https://mainnet.helius-rpc.com', rateLimiter = new RateLimiter(2, 2), cache = new ResponseCache())` — **own** limiter + cache (Esplora precedent: never evict the shared EVM/Tron cache). Free-tier Enhanced limit is 2 req/s; on 429, wait 600ms and retry once, then throw `Error('Helius API error: <status>')`. No failover host.
- Methods:
  - `addressTransactions(address, opts?: { beforeSignature?: string; limit?: number })` → `GET {host}/v0/addresses/{address}/transactions?api-key=…&limit=100[&before-signature=…]` (limit cap 100).
  - `parseTransaction(signature)` → `POST {host}/v0/transactions?api-key=…` body `{ transactions: [signature] }` → first element.
  - `getMintMetadata(mints: string[])` → JSON-RPC `POST {host}/?api-key=…` `{jsonrpc:'2.0', id:'1', method:'getAssetBatch', params:{ ids: mints }}`; map to `MintMetadata` (symbol + decimals from `token_info`); cache **per mint, 24h TTL**; fallback entry `{symbol: mint.slice(0,4)+'…', decimals: 0}` for unresolvable mints (flagged upstream as `unknown-mint`).
  - `getBalance(address)` → JSON-RPC `getBalance` → lamports string.
- **The key never appears in cache keys or log lines** — `cache.buildKey('solana', path, params)` with the key stripped; error messages carry status only, never the URL.
- Tests (`jest.spyOn(global, 'fetch')`, the Esplora spec pattern): history call carries `api-key` + `limit`; 429 → one retry after backoff, then success; two 429s → throws; mint metadata cache hit skips fetch; cache key contains no api-key; parseTransaction posts the signature array.

### Task 5: `SolanaProvider` seam + `HeliusProvider` + registry routing
**Implementer:** sonnet
**Files:** Create `backend/src/modules/blockchain/solana-provider.ts` · Create `backend/src/modules/blockchain/helius.provider.ts`, `backend/src/modules/blockchain/helius.provider.spec.ts` · Modify `backend/src/modules/blockchain/provider-registry.ts`
```ts
// solana-provider.ts — cursor-paginated account-model seam (mirrors utxo-provider.ts; the
// page-number BlockchainProvider contract can't express signature cursors).
export interface SolanaFetchOptions { maxTotal?: number; startTimestamp?: number; endTimestamp?: number; }
export interface SolanaProvider {
  getAddressHistory(address: string, options?: SolanaFetchOptions): Promise<{ txs: HeliusParsedTx[]; mintMeta: Map<string, MintMetadata> }>;
  getTx(signature: string): Promise<{ tx: HeliusParsedTx; mintMeta: Map<string, MintMetadata> }>;
  getAddressInfo(address: string): Promise<RawAddressInfo>;
}
```
- The `{txs, mintMeta}` wrapper returns are a **deliberate deviation** from `UtxoProvider`'s bare arrays: mint metadata is batch-resolved per fetch and must travel with the txs so `mapSolanaHistory` stays pure (no lookups inside the normalizer).
- `HeliusProvider implements SolanaProvider`: `getAddressHistory` loops `addressTransactions` newest-first via `before-signature` cursor until `maxTotal` (default 100, cap 1000) reached, a partial page returned, or every tx in a page is older than `startTimestamp` (no server-side date filter — client-side stop + filter, mirroring `BitcoinProvider`; on mid-loop error, return accumulated pages with a warn log). After the loop, collect unique mints across kept txs → one `getMintMetadata` batch. `getAddressInfo`: balance via `getBalance`, `addressType: 'wallet'`.
- Registry: `private solanaProviders = new Map<string, SolanaProvider>()`; `getSolana(chainId)` lazily constructs `HeliusProvider` with `ConfigService.get('HELIUS_API_KEY')` for `'solana'`, else throws. The Task 3 guard in `get()` stays.
- Tests: cursor loop (2 full pages + partial), maxTotal cap, date-stop, mint batch contains only kept-tx mints, registry routing (`getSolana('solana')` returns provider; `getSolana('ethereum')` throws; `get('solana')` still throws).

## Phase 3 — Normalizer (pure functions, test-first)

### Task 6: `detectSpam`
**Implementer:** sonnet
**Files:** Create `backend/src/modules/blockchain/sol/detect-spam.ts`, `backend/src/modules/blockchain/sol/detect-spam.spec.ts`
- `KNOWN_MINTS: Record<string, true>` — hardcode USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, wSOL `So11111111111111111111111111111111111111112`; **verify each against solscan.io before committing to the file, and only add further majors (JUP, BONK, mSOL, jitoSOL) with solscan-verified addresses** — never from memory.
- `detectSpam(tx: HeliusParsedTx, transfer: HeliusTokenTransfer, address: string, mintResolved: boolean): { spam: boolean; evidence: string[] }`:
  - `unsolicited`: `transfer.toUserAccount === address` AND address appears in no transfer as sender AND `tx.feePayer !== address`.
  - `unknown-mint`: `!KNOWN_MINTS[transfer.mint] && !mintResolved` (metadata lookup failed).
  - `mass-distribution`: `tx.tokenTransfers` has ≥10 distinct `toUserAccount` values.
  - `spam: true` iff `unsolicited && (unknown-mint || mass-distribution)`. Evidence array lists every heuristic that fired, spam or not. Native SOL transfers and outgoing rows: never evaluated (caller skips).
- Fixtures: unsolicited unknown-mint airdrop (spam, both evidence strings); unsolicited USDC (not spam, evidence `['unsolicited']`); 50-recipient known-mint blast (spam via mass-distribution); outgoing unknown-mint (not evaluated); recipient who is also fee payer (not unsolicited).

### Task 7: `mapSolanaHistory`
**Implementer:** opus
**Files:** Create `backend/src/modules/blockchain/sol/map-solana-history.ts`, `backend/src/modules/blockchain/sol/map-solana-history.spec.ts` · Modify `backend/src/modules/blockchain/blockchain.service.ts` (add `solana?: SolanaContext` to `TransactionResult`, beside `utxo?` — step 0, makes the task self-sufficient)
- `decimalToRaw(amount: number | string, decimals: number): string` — **string math, no float multiplication, exponential-notation safe**. JS stringifies numbers below ~1e-6 (and ≥1e21) in exponential form — `String(0.0000001) === '1e-7'` — which a naive split-on-`.` mangles; high-decimal SPL tokens with tiny amounts will hit this. Normalize first: if the rendered string contains `e`/`E`, expand to a plain decimal string via explicit exponent handling (shift the decimal point by the exponent), THEN split on `.`, pad/truncate the fraction to `decimals`, strip leading zeros. Export it (frontend never needs it; MCP/service reuse might).
- `mapSolanaHistory(address: string, txs: HeliusParsedTx[], mintMeta: Map<string, MintMetadata>): TransactionResult[]` — pure.
- Rules:
  - Skip failed txs (`transactionError != null`).
  - `transferIndex` = position in `[...tx.nativeTransfers, ...tx.tokenTransfers]` (Helius parse is deterministic — the index is stable across fetches; this is the edge identity).
  - Emit a row per transfer where `fromUserAccount === address || toUserAccount === address`; skip zero-amount transfers and transfers with a null endpoint on the side they'd need (**never synthesize a sender or recipient**).
  - Native row: `amount = String(transfer.amount)` (lamports), `token: {address:'', symbol:'SOL', decimals:9}`, context `kind:'native'`.
  - SPL row: `amount = decimalToRaw(transfer.tokenAmount, meta.decimals)`, `token: {address: mint, symbol: meta.symbol, decimals: meta.decimals}`, context `kind:'spl'` with `mint`, `decimals`, token accounts. Spam evaluation (Task 6) only for incoming SPL rows; `spam`/`spamEvidence` onto the context.
  - Every row: `chain:'solana'`, `txHash: signature`, `timestamp` ISO from unix seconds, `blockNumber: slot`, full `solana` context (`transferIndex`, `feePayer`, `type`, `source`, `slot`).
  - Self-transfer (`from === to === address`): one row, kept.
  - Dedup by `edgeIdentityKey` (solana branch active) before returning.
- Fixtures/assertions: simple incoming SOL (lamports string, decimals 9); outgoing USDC 1.5 with 6 decimals → amount `'1500000'` (the decimal→raw canary); swap tx with 1 native + 2 token transfers touching the address → distinct `transferIndex` per row, distinct identity keys; unsolicited unknown-mint airdrop → `spam: true` with evidence; failed tx skipped; zero-amount skipped; transfer with null `fromUserAccount` on an incoming row → from stays the null-side rule (row skipped, never a fabricated sender); self-transfer; `decimalToRaw` precision cases (`0.000001`/6 → `'1'`; `0.0000001`/9 → `'100'` — the number input stringifies as `'1e-7'`, the exponential canary; `123456789.123456789`/9; integer input; string input).

### Task 8: BlockchainService solana branch + contracts
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/blockchain/blockchain.service.ts` (branch at top of `fetchHistory`/`getTransaction`/`getAddressInfo`, beside the bitcoin branches: `if (chain === 'solana')` → `providerRegistry.getSolana('solana')` → `mapSolanaHistory` / single-tx mapping / addressInfo; forward `startDate`/`endDate`→timestamps and `maxTotal` exactly as the bitcoin branch does) · Modify `contracts/schemas/blockchain.yaml` (`SolanaContext` schema mirroring the Task 2 interface, `additionalProperties: false` — deliberately stricter than the sibling `UtxoContext`, which predates the convention; `TransactionResult.solana` optional `$ref`; genericize the `maxTotal` description to "used by the bitcoin and solana providers") · `npm run gen` · Extend `blockchain.service.spec.ts`
- `getTransaction('…','solana')`: `getTx` → detail result — representative `from` = fee payer, `to` = recipient of the largest transfer (documented as representative-only, same convention as the bitcoin branch); `tokenTransfers` on the detail result populated from SPL transfers (the existing field fits); `amount` = the largest transfer's raw value.
- The solana branch bypasses the zero-value filter, `normalizeAddr` lowercasing, and the EVM token-transfer loop entirely.
- Tests: mocked SolanaProvider — fetchHistory returns rows with `solana` context intact; maxTotal forwarded; date bounds forwarded as timestamps; EVM regression spec stays green.

## Phase 4 — Persistence contract

### Task 9: `solana` through all four whitelist sites
**Implementer:** opus
**Files:** Modify `backend/src/modules/traces/dto/import-transactions.dto.ts` (`SolanaContextDto implements SolanaContext` — every field decorated, `@ValidateIf` for nullable, `spamEvidence` `@ArrayMaxSize(10)`; `ImportTransactionItem` gains `@IsOptional() @ValidateNested() @Type(() => SolanaContextDto) solana?: SolanaContextDto`) · Modify `contracts/schemas/traces.yaml` (`ImportTransactionItem.solana` `$ref './blockchain.yaml#/SolanaContext'`, beside the `utxo` ref) · Modify `backend/src/modules/mcp/tools/write-tools.ts` (`solanaContextSchema = z.strictObject({...})` mirroring the interface, comment matching the utxo one — unknown keys rejected, a model inventing fields should be told, not obeyed; `importTxItemSchema` gains `solana: solanaContextSchema.optional()`) · Modify `backend/src/modules/ai/investigation-data.utils.ts` (`AgentEdge.solana?: SolanaContext`, passed through as-is in `stripTraceForAgent` — bounded, no summarization) · `npm run gen`
- **The canary** (the reason this task exists): extend `backend/src/modules/traces/dto/import-transactions.dto.spec.ts` with `it('THE CANARY: a full solana payload survives whitelisting intact', ...)` — run an import payload with every `SolanaContext` field through the mirrored `ValidationPipe({ whitelist: true, transform: true })` and assert nothing is stripped. The `implements` clause makes shape drift a compile error, the canary makes silent stripping a test failure.
- Also: write-tools spec (solana item parses; junk key inside `solana` rejected); stripTraceForAgent spec (edge with `solana` → context present on agent edge; edge without → absent).

### Task 10: Import path + searchBetween
**Implementer:** sonnet
**Files:** Modify `backend/src/modules/traces/traces.service.ts` · Extend `backend/src/modules/traces/traces.service.spec.ts`
- `importTransactions`: solana rows flow the existing **non-junction** path untouched except: when `item.solana` is present, expand the wire string token into the object form — `{ address: item.solana.mint ?? '', symbol: <the string token>, decimals: item.solana.kind === 'native' ? 9 : (item.solana.decimals ?? 0) }` (the `btcToken()` precedent, per-mint; define a `solanaToken(item)` helper beside it) — and persist `solana` on the edge. Bare solana items (no context) keep today's human-amount + string-token behavior. Addresses persist via `normalizeAddressForChain` (already case-preserving for solana); lookup keys stay `addressKey()`. **Double-check `ensureAddressNode`'s persist path**: reviewer noted its normalization routing may fall back to raw `: addr` for chains outside its explicit bitcoin branch — confirm solana addresses actually flow through `normalizeAddressForChain` (trim) rather than persisting unnormalized, and extend the branch if not.
- `searchBetween`: extend the maxTotal ternary — `dto.chain === 'solana' ? 300 :` beside bitcoin's 300. `resolveWalletSet` needs no change (junction filtering is BTC-only; solana nodes are ordinary wallets).
- `toImportItem` already collapses token object→symbol string and must carry `solana` through (mirror the `utxo` carry).
- Tests: import of two transfers from one signature creates 2 edges with distinct identities; re-import adds 0; token object rebuilt with mint + decimals from context; case-sensitive solana address persists intact but dedups case-insensitively via `addressKey`; mixed EVM+solana payload; searchBetween called with maxTotal 300 for solana.

## Phase 5 — Frontend

### Task 11: addressParser + edge types + aggregation guard
**Implementer:** sonnet
**Files:** Modify `frontend/src/utils/addressParser.ts` · Modify `frontend/src/types/investigation.ts` (`TransactionEdge.solana?: SolanaContext` beside `utxo?`) · Modify `frontend/src/hooks/useInvestigation.ts` (`aggregateCrossEdges` ~line 119: the existing utxo handling is **conditional** — `utxo: isMultiple ? undefined : first.utxo`. Mirror it exactly: `solana: isMultiple ? undefined : first.solana`. A 1:1 pass-through edge KEEPS its context — spam evidence, mint, fee payer; only true multi-tx aggregates strip it. Do not strip unconditionally.) · Extend `frontend/src/utils/addressParser.test.ts`, `frontend/src/hooks/useInvestigation.test.ts`
- `EXPLORER_PATTERNS` += `{ host:'solscan.io', chain:'solana' }`, `{ host:'explorer.solana.com', chain:'solana' }` (note: explorer.solana.com uses `/address/`, solscan uses `/account/` — the path-extraction regex must accept both segments and the base58 32–44 shape).
- `parseAddressInput` raw-address order: URL → Tron → EVM → **BTC → Solana** (BTC precedence in the ambiguous 32–34-char window; add a comment citing the leading-zero-bytes rationale).
- `inspectInput`: `family` union += `'solana'`; tx branch: bare base58 of length **80–88** → solana signature family; solscan/explorer.solana.com `/tx/` URLs → solana. **Regression-lock: bare 64-hex still classifies exactly as today (EVM default)** — a 64-char hex string is valid base58, which is why the solana window starts at 80.
- Tests: solana address paste → chain solana + solscan explorer URL; genesis-style 34-char `1…` string still classifies bitcoin (precedence lock); solscan account URL, solscan tx URL, explorer.solana.com address URL parse; an 88-char base58 signature → solana tx family; bare 64-hex unchanged; aggregate of two solana edges carries no `solana` context while a 1:1 pass-through edge keeps it.

### Task 12: Staging UX — spam rows visible, flagged, unchecked
**Implementer:** sonnet
**Files:** Create `frontend/src/utils/classifySolanaRow.ts` (+`classifySolanaRow.test.ts`) · Modify `frontend/src/components/Workspace/FetchModal.tsx` · Modify `frontend/src/components/Graph/StagingPanel.tsx`
- `classifySolanaRow(tx, fetchedAddress): { direction: 'in'|'out'|'self'; isSpam: boolean; evidence: string[] } | null` — null for rows without `tx.solana` (non-solana rows never classify, mirroring `classifyBtcRow`); direction from `from`/`to` vs `fetchedAddress`; `isSpam`/`evidence` read off the context (detection already happened server-side — the frontend only displays).
- `FetchModal.tsx`:
  - `selectableResults` filter (the exact change): `!classifyBtcRow(tx, fetchedAddress)?.isChange && !classifySolanaRow(tx, fetchedAddress)?.isSpam` — spam rows are **excluded from select-all and default-unchecked**, requiring a deliberate manual click (verbatim mirror of the change-output comment block; write the matching comment).
  - Apply the same filter at fetch-time auto-select and in `toggleAll`.
  - `SolBadges` beside `BtcBadges`: direction badge (In/Out/Self), token symbol chip, amber **"spam?"** badge with evidence tooltip when flagged (react-icons fa6, no emojis).
  - Fetch options: FetchModal has **four separate inline `chain !== 'bitcoin'` checks** (~lines 132, 133, 259, 274) plus the `maxTotal`-vs-`offset` branch (~line 136) — not one gate. Replace each with the Task 1 predicate: hide start/end block fields when `usesCursorPagination(chain)`; send `usesCursorPagination(chain) ? { maxTotal: limit } : { offset: limit }`. Do not open-code `chain === 'bitcoin' || chain === 'solana'` anywhere.
- `StagingPanel.tsx`: render `SolBadges` (compact variant) beside the BTC badges, same gating pattern.
- Tests: spam-flagged row excluded from selectable set while a clean solana row is included; toggleAll leaves spam rows untouched; direction classification; non-solana rows return null.

### Task 13: Authoring, seeding, wizard, details
**Implementer:** sonnet
**Files:** Modify `frontend/src/hooks/useWalletTransactionAuthoring.ts` · Modify `frontend/src/hooks/useCaseSeed.ts` · Modify `frontend/src/components/Onboarding/CaseOnboardingWizard.tsx` · Modify `frontend/src/components/Graph/details/TransactionDetails.tsx` · Extend the authoring hook's tests + `frontend/src/hooks/useCaseSeed.test.ts`
- `useWalletTransactionAuthoring.ts`: solana rows flow the ordinary direct-edge path (no junction logic); carry `solana` onto the authored edge; skip rows missing `from` or `to` (never synthesize — extend the line-394-style guard to `(tx.chain === 'bitcoin' || tx.chain === 'solana') && !addr`); dedup and normalization are already chain-generic. **This hook is the client-side twin of the backend import path — keep the two behaviorally identical (same guard, same context carry) or staging and server import diverge.**
- `useCaseSeed.ts`: `mapFetchedTx` carries `solana` through verbatim (one line beside the `utxo` carry). **Separately, ~line 127 has its own fetch-options ternary** — `chain === 'bitcoin' ? { maxTotal: SEED_TX_LIMIT } : { offset: SEED_TX_LIMIT }` — independent of FetchModal's. Replace it with `usesCursorPagination(chain) ? { maxTotal: … } : { offset: … }`. Without this, wizard-seeded solana fetches send `offset` to HeliusProvider and silently misbehave while Fetch-modal fetches look fine.
- `CaseOnboardingWizard.tsx` (note: `components/Onboarding/`, not Workspace): `hasBtc` (~line 139) drives **mixed-family enforcement and chain auto-derivation only** — it does NOT gate fetch options (that's the useCaseSeed ternary above). Extend the family logic so `'solana'` participates the same way (`hasSol` mirror wherever `hasBtc` feeds mixed-family checks/derivation), so a pasted solana address derives chain solana and mixes correctly with other families.
- **QuickAdd needs verification, not edits:** `QuickAddInput.tsx` ~lines 104–107 has a bitcoin-only guard blocking single-tx Quick Add (a UTXO tx has no single sender). Solana rows have a well-defined from/to (Task 8's representative mapping), so the guard stays bitcoin-only — confirm solana single-tx Quick Add works as part of this task's verification instead of extending the guard.
- `TransactionDetails.tsx`: when `edge.solana` — a compact Solana section: fee payer (with copy + explorer link), program `source`/`type`, mint + token accounts for SPL rows, spam evidence chips (amber, one per evidence string), transfer index. Follow the existing UTXO-section styling; react-icons only.

## Phase 6 — Agent surfaces & docs

### Task 14: Skill, sandbox, MCP checks, docs
**Implementer:** sonnet
**Files:** Create `backend/src/skills/solana-apis.md` · Modify `backend/src/skills/graph-mutations.md` · Modify `backend/src/modules/ai/services/script-execution.service.ts` · Extend `backend/src/modules/mcp/tools/blockchain-tools.spec.ts` · Modify `docs/supported-chains.md`, `docs/blockchain.md`, `docs/plans/todo.md`
- `solana-apis.md` (frontmatter `name: solana-apis`, description mentioning Helius parsed transactions — auto-registers via skill-registry, zero code change): Helius endpoints (`/v0/addresses/{address}/transactions` cursor pagination example, `POST /v0/transactions`, DAS `getAssetBatch`); **scripts omit `api-key` — the sandbox injects it**; units (lamports / raw token units in context rows, decimal amounts for bare imports); the `solana` import payload shape + spam semantics (flag, never suppress); a full script example (fetch → build import payload with `solana` context → import); constraints block from `bitcoin-apis.md` including the don't-log-raw-payloads warning.
- `graph-mutations.md`: chain list at ~line 83 += solana; **fix the stale group-docs chain list at ~line 212** (currently missing bitcoin too — bring it to the full 7); Native Currency Tokens section gains the SOL convention + a solana import example beside the bitcoin one; Tips (~line 375) references `solana-apis`.
- `script-execution.service.ts`: `BASE_ALLOWED_DOMAINS` += `'mainnet.helius-rpc.com'`; `injectApiKey` gains a third branch — `if (host.endsWith('.helius-rpc.com'))` (leading dot, matching every existing branch's lookalike-host defense) → set `api-key` query param from `HELIUS_API_KEY` when absent (query-param style like Etherscan, but param name `api-key`).
- MCP: chain enum already includes solana via derivation — add a spec asserting `blockchain_fetch_history` accepts `chain: 'solana'` and rows pass through with `solana` context (no summarization branch needed; assert a 20-row payload stays under the size cap).
- Docs:
  - `supported-chains.md`: at-a-glance row (Solana / solana family / SOL (9) / Helius / `HELIUS_API_KEY` required / own 2 req/s bucket); a Helius section (endpoint, auth, free-tier budget: 1M credits/mo at 100 credits per history page ≈ 10k pages, 2 req/s Enhanced; scale path: Developer $49/10M → Business $499/100M); address-formats row (base58 32–44, case-sensitive, **no prefix — BTC-precedence note**); explorer-links row (solscan.io); update "Adding a chain" for the third seam.
  - `blockchain.md`: Solana section — SolanaProvider seam, Helius parsed-transfer model (ATA resolution upstream), spam heuristics + evidence, per-transfer edge identity, units convention.
  - `todo.md` (Solana backlog section): external-trace/widget solana support deferred (DTO frozen at 6 chains — `backend/src/modules/external-trace/dto/trace-query.dto.ts`, needs its own cross-repo plan like BTC's); spam-heuristic tuning (allowlist growth, Jupiter verified-token list integration) revisit after real-case usage; Helius paid tier when 429s appear.

### Task 15: Full regression + build gate
**Implementer:** sonnet
- `npm run test --prefix backend` and `npm run test --prefix frontend` — all green.
- `npm run build --prefix backend` and `npm run build --prefix frontend` — clean.
- `npm run gen` idempotent (no dirty diff on rerun).
- Manual smoke path for /qa (needs `HELIUS_API_KEY` set): create case → add a solana address via WalletForm → Fetch (date-bounded, small limit) → verify staging shows direction badges + any spam rows flagged and unchecked → add to graph → open edge details (fee payer, mint, spam evidence) → AI chat: "fetch history for <solana addr> and add to the graph" (skill + sandbox injection path) → MCP `blockchain_fetch_history` with chain solana.
- `git status` — full change list for review. **No commits.**

## Verification (end-to-end)

1. **Unit suites** — normalizer, spam heuristics, decimal→raw math, identity, address validation are pure and fixture-tested.
2. **Whitelist survival** — Task 9's canary spec guards against silent `solana` stripping (the BTC lesson).
3. **Ambiguity locks** — Task 1/11 regression tests pin BTC-precedence and the bare-64-hex behavior so future address work can't silently flip them.
4. **Live dev smoke** (Task 15) against real Helius with a low-activity address once the key is provisioned.
5. **Regression** — EVM/Tron/BTC fetch→stage→graph flows unchanged; external-trace e2e untouched (widget deliberately frozen).
6. **No migrations** — additive JSONB field only; nothing to generate via `./migrations.sh`.
