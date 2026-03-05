# Blockchain System

Multi-chain transaction data fetching via a provider pattern. Supports EVM chains (Etherscan V2) and TRON (Tronscan). Used by the frontend for fetching transaction history and by the AI agent for investigation context.

## Directory Structure

```
backend/src/modules/blockchain/
├── blockchain.module.ts        NestJS module
├── blockchain.service.ts       Orchestration (fetch history, get transaction)
├── blockchain.controller.ts    REST endpoints
├── blockchain-provider.ts      Provider interface
├── etherscan.provider.ts       EVM chains implementation
├── tronscan.provider.ts        TRON implementation
├── provider-registry.ts        Lazy provider instantiation + shared infra
├── token-resolver.ts           Token metadata resolution (well-known DB + cache)
├── rate-limiter.ts             Token bucket rate limiter
├── response-cache.ts           In-memory TTL cache with LRU eviction
├── types.ts                    Chain configs, shared types
└── dto/
    ├── fetch-history.dto.ts
    └── get-transaction.dto.ts
```

## Supported Chains

| Chain | Chain ID | Native Currency | Explorer |
|-------|----------|----------------|----------|
| Ethereum | 1 | ETH (18 decimals) | etherscan.io |
| Polygon | 137 | MATIC (18 decimals) | polygonscan.com |
| Arbitrum | 42161 | ETH (18 decimals) | arbiscan.io |
| Base | 8453 | ETH (18 decimals) | basescan.org |
| Tron | 728126428 | TRX (6 decimals) | tronscan.org |

## Provider Interface

```typescript
interface BlockchainProvider {
  getTransactions(address: string, options?: FetchOptions): Promise<RawTransaction[]>;
  getTokenTransfers(address: string, options?: FetchOptions): Promise<RawTokenTransfer[]>;
  getTransaction(txHash: string): Promise<RawTransactionDetail>;
}
```

All providers implement these three methods. The `ProviderRegistry` creates the right provider based on chain ID.

## Provider Registry

Singleton service that lazy-loads providers on first use.

- `get(chainId)` → returns cached provider or creates new one
- Routes `tron` → `TronscanProvider`, everything else → `EtherscanProvider`
- All providers share one `RateLimiter` and one `ResponseCache` instance
- Reads API keys from env: `ETHERSCAN_API_KEY`, `TRONSCAN_API_KEY`

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
| **How** | `BlockchainService` → `ProviderRegistry` → provider | Child Node.js process with `fetch()` |
| **Rate limiting** | Shared token bucket | None (agent manages in script) |
| **Caching** | `ResponseCache` (1h / 24h TTL) | None |
| **Chains** | 5 configured chains | Any (agent writes the URL) |
| **Graph mutations** | Frontend auto-saves via `PATCH /traces/:id` | Scripts POST to `/traces/:id/import-transactions` |

The backend is the single authority for all data mutations. AI scripts fetch blockchain data via external APIs, then POST to the import endpoint to add nodes/edges to the graph. The skill documents (`blockchain-apis.md`, `graph-mutations.md`) provide endpoint formats and script patterns.
