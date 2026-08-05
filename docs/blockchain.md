# Blockchain System

Multi-chain transaction data fetching via a provider pattern. Supports EVM chains (Etherscan V2) and TRON (Tronscan). Used by the frontend for fetching transaction history and by the AI agent for investigation context.

## Directory Structure

```
backend/src/modules/blockchain/
├── blockchain.module.ts        NestJS module
├── blockchain.service.ts       Orchestration (fetch history, get transaction)
├── blockchain.controller.ts    REST endpoints
├── blockchain-provider.ts      Provider interface (account-model chains)
├── etherscan.provider.ts       EVM chains implementation
├── tronscan.provider.ts        TRON implementation
├── utxo-provider.ts            Provider interface (UTXO chains)
├── bitcoin.provider.ts         Bitcoin implementation (UtxoProvider)
├── esplora-client.ts           Esplora REST client: hosts, failover, own rate limiter + cache
├── btc/
│   ├── map-btc-history.ts      Esplora txs -> canvas rows (direction + junction rules)
│   ├── detect-change.ts        Change-output heuristics (pure, evidence-labelled)
│   └── detect-patterns.ts      CoinJoin/consolidation/coinbase pattern detection (pure)
├── provider-registry.ts        Lazy provider instantiation + shared infra
├── token-resolver.ts           Token metadata resolution (well-known DB + cache)
├── rate-limiter.ts             Token bucket rate limiter
├── response-cache.ts           In-memory TTL cache with LRU eviction
├── types.ts                    Chain configs, shared types
└── dto/
    ├── fetch-history.dto.ts
    ├── get-address-info.dto.ts
    └── get-transaction.dto.ts
```

## Supported Chains

> Ops detail per chain — providers, API keys (Bitcoin is keyless), rate/volume budgets, and scale paths — lives in [`supported-chains.md`](./supported-chains.md).

| Chain | Chain ID | Native Currency | Explorer |
|-------|----------|----------------|----------|
| Ethereum | 1 | ETH (18 decimals) | etherscan.io |
| Polygon | 137 | MATIC (18 decimals) | polygonscan.com |
| Arbitrum | 42161 | ETH (18 decimals) | arbiscan.io |
| Base | 8453 | ETH (18 decimals) | basescan.org |
| Tron | 728126428 | TRX (6 decimals) | tronscan.org |
| Bitcoin | — (no numeric chain ID; UTXO chain) | BTC (8 decimals) | mempool.space |

## Provider Interface

```typescript
interface BlockchainProvider {
  getTransactions(address: string, options?: FetchOptions): Promise<RawTransaction[]>;
  getTokenTransfers(address: string, options?: FetchOptions): Promise<RawTokenTransfer[]>;
  getTransaction(txHash: string): Promise<RawTransactionDetail>;
}
```

All account-model providers (EVM chains + Tron) implement these three methods, and are created via `ProviderRegistry.get(chainId)`. Bitcoin does **not** implement this interface — see [Bitcoin](#bitcoin) below.

## Provider Registry

Singleton service that lazy-loads providers on first use.

- `get(chainId)` → returns cached provider or creates new one
- Routes `tron` → `TronscanProvider`, everything else → `EtherscanProvider`. `get('bitcoin')` throws — Bitcoin has no account-model provider, use `getUtxo()` instead.
- `getUtxo(chainId)` → returns cached `UtxoProvider` or creates one. Only `'bitcoin'` is registered (→ `BitcoinProvider`); any other chain throws.
- All account-model providers share one `RateLimiter` and one `ResponseCache` instance. `BitcoinProvider` does **not** — see [Bitcoin](#bitcoin).
- Reads API keys from env: `ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`. Bitcoin needs no key.

## Etherscan Provider

Covers all EVM chains via Etherscan V2's unified API (`https://api.etherscan.io/v2/api`).

### `getTransactions(address)`
- Calls `account/txlist` with chain-specific `chainid`
- Paginates with `page` + `offset` (max 10,000)

### `getTokenTransfers(address)`
- Calls `account/tokentx`
- Same pagination

### `getTransaction(txHash)`
- Three parallel calls: `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`
- Extracts token transfers from receipt logs
- Normalizes hex values (gas, amounts) to decimal strings
- Gets block timestamp from block data

## Tronscan Provider

Covers the TRON network via Tronscan's API (`https://apilist.tronscanapi.com/api`).

### `getTransactions(address)`
- Calls `transfer` endpoint (native TRX transfers)
- Auth header: `TRON-PRO-API-KEY`

### `getTokenTransfers(address)`
- Calls `token_trc20/transfers`

### `getTransaction(txHash)`
- Calls `transaction-info`

### Key Differences from EVM
- Base58 addresses (case-sensitive, `T...` prefix)
- Sun units (1 TRX = 1,000,000 sun) vs Wei (1 ETH = 10^18 wei)
- Timestamps in milliseconds (vs seconds for Etherscan)

## Bitcoin

Bitcoin is a **UTXO chain**, not an account-model chain: there's no "transaction list for an address" the way Etherscan/Tronscan expose one — a Bitcoin address's history is the set of transactions that spend or create one of its outputs, resolved via an indexer. That's why Bitcoin is served through a parallel `UtxoProvider` interface (`getAddressHistory`, `getTx`, `getAddressInfo`) and `ProviderRegistry.getUtxo('bitcoin')`, not `BlockchainProvider`/`get()` — the two interfaces diverge exactly where the data models diverge: cursor pagination (`last_seen_txid`) instead of `page`/`offset`, and no separate "token transfer" concept.

### EsploraClient

Talks to an Esplora-compatible REST API — **mempool.space primary, blockstream.info failover** (mempool.space's electrs is a fork of Blockstream's esplora, so the endpoint shapes match). A request retries on the failover host for network errors, HTTP 429, or any 5xx; other 4xx statuses are not retried since they'd fail identically on both hosts. Both hosts are keyless at MVP volume — no API key management.

`EsploraClient` owns its **own** `RateLimiter(3, 3)` and its **own** `ResponseCache` instance — deliberately not the `ProviderRegistry`'s shared ones. BTC transaction payloads (a CoinJoin can carry 50+ inputs/outputs) are large enough that sharing the 200-entry EVM/Tron cache would evict it. Cache TTL is 1 hour; the `/txs/mempool` endpoint is never cached (contents change constantly).

### BitcoinProvider (`UtxoProvider`)

`getAddressHistory(address, options)`:
- Prepends unconfirmed mempool transactions (best-effort — a mempool fetch failure logs a warning and continues without them, not a hard error).
- Paginates confirmed transactions 25/page via the cursor endpoint, stopping on a partial page, on `maxTotal` being reached, or (when `startTimestamp` is set) once an entire page is older than it.
- `maxTotal` defaults to **100**, hard-capped at **1000** regardless of what's requested.
- Optional `startTimestamp`/`endTimestamp` filtering applied after fetch (mempool txs have no `block_time`, so they're treated as "now" for filtering).

`getTx(txid)` / `getAddressInfo(address)` are thin wraps over the client — address info balance is `chain_stats.funded_txo_sum - chain_stats.spent_txo_sum`.

### `mapBtcHistory` — direction rules

Maps raw Esplora transactions into canvas-ready rows for one subject address. The hard rule, load-bearing for the whole BTC model: **a sender is never synthesized.** A row only names a `from` address when the ledger itself names exactly one payer.

- **Outgoing** (address among `vin`): one row per non-`OP_RETURN` output, including change and self-sends — covers "address in both inputs and outputs" so no output is emitted twice.
- **Incoming** (address only among `vout`): one row per output paying the address. The sender is attributed only when the tx has **exactly one input** and that input's `prevout` carries a decodable address — the one case the ledger names the payer outright. Every other case (multiple inputs, coinbase, undecodable prevout) emits `from: ''` with `junction: true` instead of guessing.
- Neither: not the subject's transaction, no rows.

`OP_RETURN` outputs never produce a row (they pay no one) but are retained in `utxo.outputs` with `opReturn: true`.

Two pure, evidence-labelled heuristics run per transaction (`btc/detect-change.ts`, `btc/detect-patterns.ts`), both shown to investigators with their basis, never asserted as fact:
- **Change detection**: address-reuse (an output pays back to one of the tx's own input addresses — certain), or script-type-match + non-round-value (probable; suppressed entirely on CoinJoin-shaped transactions, where any output could belong to a stranger).
- **Pattern detection**: `coinbase`, `possible-coinjoin` (≥5 in, ≥5 out, ≥3 outputs sharing one value), `consolidation` (≥5 in, ≤2 out), `multi-input` (informational).

### Junction model

A transaction whose shape has no honest address→address rendering (junction patterns above, or an outgoing row with >3 non-change payment outputs, or an unattributable incoming row) becomes a **tx-junction node** instead: `kind: 'txJunction'`, `address` = the txid, `utxoTx` holding the full ledger record exactly once (so a 50-leg CoinJoin doesn't copy its inputs/outputs arrays onto 50 edges). Each real participant gets a **leg edge** — `from: counterparty, to: junction` for an input leg, `from: junction, to: counterparty` for an output leg — identified by `${txid}:in:${legIndex}` or `${txid}:${vout}` (`edgeIdentityKey` in `generated/shared/edge-identity.ts`), not by its endpoints, so relabeling or re-fetching the same leg is recognized as the same fact. This is built by `TracesService.importTransactions` from any row with `utxo.junction: true` — see `planJunction` and the "Bitcoin junction rows" block in `traces.service.ts`.

### Contract

`TransactionResult.utxo` and `ImportTransactionItem.utxo` share one schema, `UtxoContext`, defined once in `contracts/schemas/blockchain.yaml` and referenced from `traces.yaml` — a fetch result is forwarded verbatim to `/import-transactions`, so the two must never drift. Mirrors `backend/src/modules/blockchain/types.ts#UtxoContext`.

### Units

Esplora returns everything in **satoshis**. Rows carrying a `utxo` block use satoshis (as decimal strings) for `amount` too. Only a bare BTC import (no `utxo`) uses decimal BTC — see the `bitcoin-apis` skill and `graph-mutations.md` for the import-side detail.

### `searchBetween` cap

Bitcoin's advanced-search fetch cap (`TracesService.searchBetween`) is **`maxTotal: 300`** per side — lower than Tron's 2000 and the EVM default of 10000, reflecting Esplora's 25-tx/page pagination cost.

### MCP summarization

`blockchain_fetch_history` (MCP tool) runs every row's `utxo` block through `summarizeUtxo()` before applying its 8KB result cap — collapsing `inputs[]`/`outputs[]` to counts plus the change verdict for that row's own output, since a raw 50-input CoinJoin row would otherwise consume the whole budget by itself. `blockchain_get_transaction` (single bounded object) does not summarize — it returns the full `utxo`.

## Rate Limiter

Token bucket algorithm shared across all providers.

- **Max tokens**: 5
- **Refill rate**: 5 tokens/second
- **Behavior**: `acquire()` returns immediately if tokens available, otherwise queues the request and resolves when a token is freed
- Prevents hitting Etherscan's 5 calls/sec free-tier limit

## Response Cache

In-memory TTL cache with LRU eviction.

| Setting | Value |
|---------|-------|
| Max entries | 200 |
| Transaction data TTL | 1 hour |
| Token metadata TTL | 24 hours |
| Key format | `{chain}:{endpoint}:{sorted_params}` |
| Eviction | Expired entries first, then oldest by expiration |

## Token Resolver

Resolves token contract addresses to metadata (symbol, decimals, name).

### Resolution Order
1. **Memory cache** — instant lookup for previously seen tokens
2. **Well-known DB** — hardcoded entries for common tokens per chain

### Well-Known Tokens
- **Ethereum**: USDC, USDT, WETH, DAI, WBTC
- **Polygon**: USDC, USDT, WETH, DAI, WBTC
- **Arbitrum**: USDC, USDT, WETH, DAI, WBTC
- **Base**: USDC, WETH, DAI
- **Tron**: USDT, USDC, WBTC, WETH (TRC-20 addresses)

For unknown tokens, `resolveFromTransfer()` creates an entry from the transfer event data (symbol, decimals come from the API response).

## Blockchain Service

Orchestrates providers and normalizes results.

### `fetchHistory(address, chain, options?)`

1. Fetch native transactions and token transfers **in parallel**
2. Deduplicate by `{hash}-{from}-{to}-{tokenAddress}`
3. Normalize addresses (lowercase for EVM, preserve Base58 for Tron)
4. Filter out error transactions and zero-value transfers
5. Resolve token metadata
6. Add UUIDs, sort by timestamp descending

Returns `{ transactions: TransactionResult[], chain, address }`.

### `getTransaction(txHash, chain)`

1. Call provider's `getTransaction()`
2. Map token transfer details with resolved metadata
3. Check for errors

Returns `{ txHash, from, to, chain, amount, timestamp, blockNumber, token, tokenTransfers, isError }`.

## Endpoints

### `POST /blockchain/fetch-history`

```typescript
{
  address: string,      // wallet address
  chain: string,        // e.g. "ethereum", "tron"
  options?: {
    startBlock?: number,
    endBlock?: number,
    page?: number,
    offset?: number,
    sort?: 'asc' | 'desc'
  }
}
```

### `POST /blockchain/get-transaction`

```typescript
{
  txHash: string,
  chain: string
}
```

## AI Scripts vs Backend Providers

These are **separate paths**:

| | Backend Providers | AI Scripts |
|-|------------------|------------|
| **Used by** | Frontend UI (fetch history, staging panel) | AI agent (`execute_script` tool) |
| **How** | `BlockchainService` → `ProviderRegistry` → provider | isolated-vm V8 sandbox with domain-whitelisted `fetch()` bridge |
| **Rate limiting** | Shared token bucket | None (agent manages in script) |
| **Caching** | `ResponseCache` (1h / 24h TTL) | None |
| **Chains** | 6 configured chains (incl. Bitcoin via `getUtxo`) | Any (agent writes the URL) |
| **Isolation** | In-process (NestJS service) | V8 isolate — no fs, child_process, net, os access |
| **Graph mutations** | Frontend auto-saves via `PATCH /traces/:id` | Scripts POST to `/traces/:id/import-transactions` |

The backend is the single authority for all data mutations. AI scripts fetch blockchain data via external APIs, then POST to the import endpoint to add nodes/edges to the graph. The skill documents (`etherscan-apis.md`, `tronscan-apis.md`, `bitcoin-apis.md`, `graph-mutations.md`) provide endpoint formats and script patterns.
