# Supported Chains

Operational reference for every chain Daubert can trace: which data provider powers it, what API key (if any) it needs, the rate/volume budgets, and the scale path when free tiers run out. This is the ops-focused subset of [`blockchain.md`](./blockchain.md) — see that doc for the provider architecture, normalization pipeline, and the Bitcoin UTXO model.

Source of truth for chain definitions in code: `shared/chains.ts` (gen-copied to both packages; drives backend `CHAIN_CONFIGS`, frontend dropdowns, MCP enums, and explorer URL builders).

## At a glance

| Chain | Family | Native currency | Data provider | API key | Our internal budget |
|-------|--------|-----------------|---------------|---------|---------------------|
| Ethereum | EVM | ETH (18) | Etherscan V2 | `ETHERSCAN_API_KEY` (required) | shared 5 req/s bucket |
| Polygon | EVM | MATIC (18) | Etherscan V2 | same key | shared 5 req/s bucket |
| Arbitrum | EVM | ETH (18) | Etherscan V2 | same key | shared 5 req/s bucket |
| Base | EVM | ETH (18) | Etherscan V2 | same key | shared 5 req/s bucket |
| Tron | Tron | TRX (6) | Tronscan | `TRONSCAN_API_KEY` (required) | shared 5 req/s bucket |
| **Bitcoin** | UTXO | BTC (8) | **mempool.space → blockstream.info (keyless)** | **none** | own 3 req/s bucket |
| **Solana** | Solana | SOL (9) | **Helius** | `HELIUS_API_KEY` (required) | own 2 req/s bucket |

Three env keys are validated at boot (`backend/src/config/env.validation.ts`) — the app refuses to start without them: `ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`, `HELIUS_API_KEY`. **There is deliberately no `BITCOIN_API_KEY`**: Bitcoin runs entirely on public, keyless Esplora endpoints.

## EVM chains — Etherscan V2

- **API:** `https://api.etherscan.io/v2/api` — one unified API for all four EVM chains, selected via the numeric `chainid` param (1 / 137 / 42161 / 8453).
- **Auth:** `?apikey=` query param, from `ETHERSCAN_API_KEY`. One key covers all four chains.
- **Free-tier limit:** 5 req/s — which is why the shared `RateLimiter(5, 5)` in `ProviderRegistry` exists.
- **Caching:** shared 200-entry `ResponseCache` (1h tx data, 24h token metadata).
- **Script sandbox:** the Etherscan-family domains are whitelisted and the key is injected server-side by the fetch bridge (`injectApiKey`) — AI scripts never see the raw key.
- **Scale path:** Etherscan paid tiers (higher req/s) if the shared bucket becomes the bottleneck.

## Tron — Tronscan

- **API:** `https://apilist.tronscanapi.com/api`.
- **Auth:** `TRON-PRO-API-KEY` header, from `TRONSCAN_API_KEY`.
- **Quirks handled in the provider:** millisecond timestamps, sun units (1 TRX = 10^6 sun), case-sensitive Base58 addresses (`T…`), hash-route explorer URLs (`/#/address/`, `/#/transaction/`).
- **Caching / limiting:** shares the registry's bucket and cache with the EVM chains.
- **Script sandbox:** tronscanapi/trongrid domains whitelisted, key injected server-side.

## Bitcoin — Esplora (mempool.space + blockstream.info), keyless

- **API:** the Esplora REST shape. `EsploraClient` (`backend/src/modules/blockchain/esplora-client.ts`) tries **`https://mempool.space/api`** first and **fails over to `https://blockstream.info/api`** on network errors, HTTP 429, or any 5xx (other 4xx are not retried — they'd fail identically on both hosts). The two hosts are independently operated but API-compatible (mempool.space's electrs is a fork of Blockstream's esplora), so failover is a base-URL swap, not a second implementation.
- **Auth: none.** No key, no env var, no `injectApiKey` branch, nothing to provision for prod. Both hosts are on their public tiers.
- **Public-tier limits (upstream):** mempool.space ~200 req/min on `/api`; blockstream.info roughly ~50 req/s (community-reported, not an SLA). Both return 429 under load — which triggers our failover.
- **Our budget:** a dedicated `RateLimiter(3, 3)` (~3 req/s) — intentionally well under mempool.space's public limit — plus a **dedicated** `ResponseCache` (1h TTL; the `/txs/mempool` endpoint is never cached) so large BTC payloads can't evict the EVM/Tron cache.
- **Pagination reality:** confirmed address history pages at 25 txs per request (cursor via `last_seen_txid`). Fetch caps: `maxTotal` default 100, hard cap 1,000; advanced search uses 300. A very active address is deliberately slow — use date bounds and small limits.
- **Script sandbox:** `mempool.space` and `blockstream.info` are whitelisted domains; no key injection (nothing to inject). The `bitcoin-apis` skill documents the endpoints for AI scripts.
- **Testnet:** not wired up (out of scope; both hosts expose testnet/signet endpoints if ever needed).

### Bitcoin scale path (when public tiers aren't enough)

In order (from the 12-provider comparison done during planning):

1. **Blockstream Explorer API key** — their paid product has a free tier of 500k req/month with an API key, then ~$100/mo. First move if we see sustained 429s: add a key field + host config to `EsploraClient` (the seam already exists).
2. **mempool.space Pro** — 20 EUR/mo for 1M req/month.
3. **Self-hosted electrs/Esplora** — full control, no third-party dependency; requires a full Bitcoin node (~600GB+) plus indexer, ~$40–100/mo infra and real ops burden. The escape hatch, not the default.

When a paid key enters the picture, revisit the deferred **blockchain API key hardening** item (`docs/plans/todo.md`) — a paid key is worth proxy-protecting in a way the current free keys aren't.

## Solana — Helius

- **API:** `https://mainnet.helius-rpc.com` — Helius's Enhanced Transactions API (parsed transfers, `GET /v0/addresses/:address/transactions` and `POST /v0/transactions`) plus its JSON-RPC DAS method `getAssetBatch` for mint metadata. `HeliusClient` (`backend/src/modules/blockchain/helius-client.ts`).
- **Auth:** `?api-key=` query param, from `HELIUS_API_KEY`.
- **Free-tier budget:** 1,000,000 credits/month. Address-history pages cost ~100 credits each, so the free tier covers roughly **10,000 history pages/month** (up to 100 txs/page) before mint-metadata and single-tx lookups even count against it. Enhanced Transactions endpoints (history, parse) are additionally capped at **2 req/s**; the plain JSON-RPC endpoints (`getAssetBatch`, `getBalance`) allow **10 req/s**.
- **Caching:** a **dedicated** `ResponseCache` inside `HeliusClient` — mint metadata cached 24h (immutable once resolved), parsed single-tx lookups 1h, address-history pages 1min (recent history can still grow between calls). Never shares the EVM/Tron registry cache, same rationale as Bitcoin (large payloads would evict it).
- **Our budget:** a dedicated `RateLimiter(2, 2)` in `HeliusClient`, matching Helius's tighter Enhanced-API limit (Esplora's is `(3, 3)`).
- **Pagination reality:** 100 tx/page, cursor via `before-signature` (the prior page's last `signature`). Fetch caps: `maxTotal` default 100, hard cap 1,000; advanced search (`searchBetween`) uses 300 — same shape as Bitcoin's caps, reflecting the same cursor-pagination cost.
- **Script sandbox:** `mainnet.helius-rpc.com` is a whitelisted domain and the key is injected server-side by the fetch bridge (`injectApiKey`) — AI scripts never see the raw key. The `solana-apis` skill documents the endpoints for AI scripts.
- **Testnet:** not wired up (out of scope; Helius supports devnet if ever needed).

### Solana scale path (when the free tier isn't enough)

1. **Helius Developer** — $49/mo, 10M credits/month. First move if we see sustained 429s or credit exhaustion.
2. **Helius Business** — $499/mo, 100M credits/month.

When a paid key enters the picture, revisit the deferred **blockchain API key hardening** item (`docs/plans/todo.md`), same as the Bitcoin scale-path note above.

## Address formats (validated in `shared/address.ts`)

| Chain family | Format | Case rules |
|--------------|--------|-----------|
| EVM | `0x` + 40 hex | case-insensitive; normalized to lowercase |
| Tron | `T` + 33 Base58 | case-sensitive; preserved |
| Bitcoin | P2PKH `1…`, P2SH `3…` (Base58); bech32/bech32m `bc1…` | Base58 case-sensitive, preserved; bech32 lowercase-only (mixed case rejected) |
| Solana | Base58, 32–44 chars, **no prefix** | Case-sensitive, preserved |

Solana has no address prefix, so a 32–34 char Base58 string starting with `1` or `3` matches both the Bitcoin shape and the Solana shape. Auto-detection resolves this **BTC-first** — a genuine Solana pubkey that short would need ~5 leading zero bytes to encode into so few Base58 characters, astronomically rare in practice. Chain-explicit validation (`validateAddressForChain`) is unaffected, since it checks a single chain's shape rather than the combined union.

## Explorer links (from `shared/chains.ts`)

| Chain | Address | Transaction |
|-------|---------|-------------|
| Ethereum | etherscan.io/address/… | etherscan.io/tx/… |
| Polygon | polygonscan.com/address/… | polygonscan.com/tx/… |
| Arbitrum | arbiscan.io/address/… | arbiscan.io/tx/… |
| Base | basescan.org/address/… | basescan.org/tx/… |
| Tron | tronscan.org/#/address/… | tronscan.org/#/transaction/… |
| Bitcoin | mempool.space/address/… | mempool.space/tx/… |
| Solana | solscan.io/account/… | solscan.io/tx/… |

## Adding a chain

Because chain config is consolidated, a new account-model chain is: one entry in `shared/chains.ts`, an address-family branch in `shared/address.ts` (if it's a new format), a provider (or an existing one if Etherscan V2 covers it), `npm run gen`, an icon in `ChainSelect`, sandbox domains + skill doc for the AI. A new UTXO chain additionally reuses the `UtxoProvider` seam; a new **cursor-paginated** account-model chain (Solana's shape — signature cursors, not page numbers) reuses the `SolanaProvider` seam instead, the third provider interface alongside `BlockchainProvider` (page/offset) and `UtxoProvider`. The public `/external/trace` widget's chain list (`SUPPORTED_CHAINS` in `trace-query.dto.ts`) is maintained independently of `shared/chains.ts` — it no longer excludes Bitcoin (added 2026-08), but stays intentionally frozen at those 6 chains (Solana not yet included); extending it further is still always a deliberate, separate decision, not something `npm run gen` picks up automatically.
