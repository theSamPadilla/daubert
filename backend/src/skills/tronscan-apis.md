---
name: tronscan-apis
description: Tronscan and TronGrid API reference for TRON chain queries (TRX, TRC-20, account info)
---

# Tronscan API

**Base URL:** `https://apilist.tronscanapi.com/api`

> **Auth header is injected automatically.** Do not include `TRON-PRO-API-KEY` in your headers — the sandbox adds it for you.

## Endpoints

### accountv2
Account detail including TRX balance, bandwidth, energy.

| Param   | Required | Description       |
|---------|----------|-------------------|
| address | yes      | TRON address      |

Key response: `balance` (sun), `bandwidth`, `tokens[]`, `frozen`, `representative`.

### account/tokens
Token holdings for an account.

| Param   | Required | Description       |
|---------|----------|-------------------|
| address | yes      | TRON address      |
| start   | no       | Offset (default 0)|
| limit   | no       | Page size         |

Key response: `data[]` with `{tokenId, tokenAbbr, tokenName, balance, tokenDecimal, tokenType}`.

### transaction
Transaction list for an address.

| Param        | Required | Description              |
|--------------|----------|--------------------------|
| address      | yes      | TRON address             |
| start        | no       | Offset                   |
| limit        | no       | Page size (default 50)   |
| sort         | no       | `timestamp` or `-timestamp` |
| start_timestamp | no   | Filter start (ms)        |
| end_timestamp   | no   | Filter end (ms)          |

Key response: `data[]` with `{hash, ownerAddress, toAddress, amount, confirmed, block, timestamp, contractType}`.

### transaction-info
Transaction detail by hash.

| Param | Required | Description       |
|-------|----------|-------------------|
| hash  | yes      | Transaction hash  |

Key response: `{hash, block, timestamp, ownerAddress, toAddress, contractData, confirmed, contractRet}`.

### transfer
TRX and TRC10 transfers.

| Param   | Required | Description              |
|---------|----------|--------------------------|
| address | yes      | TRON address             |
| start   | no       | Offset                   |
| limit   | no       | Page size                |
| sort    | no       | `timestamp` or `-timestamp` |

Key response: `data[]` with `{transactionHash, transferFromAddress, transferToAddress, amount, confirmed, block, timestamp, tokenInfo}`.

### token_trc20/transfers
TRC-20 token transfers.

| Param          | Required | Description           |
|----------------|----------|-----------------------|
| relatedAddress | yes      | TRON address          |
| start          | no       | Offset                |
| limit          | no       | Page size             |
| sort           | no       | `timestamp` or `-timestamp` |

Key response: `token_transfers[]` with `{transaction_id, from_address, to_address, quant, block_ts, tokenInfo{tokenId, tokenAbbr, tokenName, tokenDecimal}}`.

### contract
Contract detail.

| Param   | Required | Description       |
|---------|----------|-------------------|
| contract | yes     | Contract address  |

Key response: `{address, name, creator, balance, trxCount, tokenInfo}`.

### token/price
Token price and market data.

| Param | Required | Description       |
|-------|----------|-------------------|
| token | yes      | Token ID/address  |

Key response: `{priceInTrx, priceInUsd, volume24h, marketCap}`.

### Pagination
- Use `start` (offset) + `limit` (page size).
- Response includes `total` or `rangeTotal` for total count.

### Rate Limits
- Free: 15 requests/sec. Pro key recommended for sustained use.

---

# TronGrid v1

**Base URL:** `https://api.trongrid.io`

> **Auth header is injected automatically** (same as Tronscan).

## Endpoints

### v1/accounts/{address}
Account info (balance, permissions, resources).

Key response: `data[0]` with `{address, balance, create_time, trc20[]}`.

### v1/accounts/{address}/transactions
Transaction history.

| Param          | Required | Description              |
|----------------|----------|--------------------------|
| limit          | no       | Page size (default 20, max 200) |
| fingerprint    | no       | Cursor for next page     |
| only_confirmed | no       | `true` for confirmed only |
| min_timestamp  | no       | Filter start (ms)        |
| max_timestamp  | no       | Filter end (ms)          |

Key response: `data[]` transactions, `meta.fingerprint` for pagination.

### v1/accounts/{address}/transactions/trc20
TRC-20 transfer history.

Same params as above, plus:

| Param            | Required | Description       |
|------------------|----------|-------------------|
| contract_address | no       | Filter by token   |

Key response: `data[]` with `{transaction_id, from, to, value, token_info{symbol, address, decimals, name}}`.

### Pagination
- Uses cursor-based pagination via `fingerprint` in response `meta`.
- Pass `fingerprint` as query param to get next page.

---

## Usage Notes

- **Sun conversion:** TRON amounts are in sun (÷ 10^6 for TRX).
- **Address format:** `T...` (base58, case-sensitive).
- **Timestamps:** Tronscan/TronGrid return Unix milliseconds.
- If you need an endpoint not listed here, use `web_search` to find the current API documentation.

## Script Patterns

Use these patterns with the `execute_script` tool. Scripts run in a sandboxed V8 isolate with top-level await.

> **API keys are injected automatically by the sandbox.** Do not read them from `process.env` or include them in URLs/headers. The only env var available is `process.env.API_URL` (the backend base URL for graph mutations).

### Tronscan fetch helper

```js
async function tronscan(endpoint, params = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`https://apilist.tronscanapi.com/api/${endpoint}?${qs}`);
  return res.json();
}
```

### Parallel calls with Promise.all

```js
const addresses = ['TXYZ...', 'TABC...', 'TDEF...'];
const results = await Promise.all(
  addresses.map(addr => tronscan('transaction', { address: addr, limit: '50', sort: '-timestamp' }))
);
results.forEach((res, i) => console.log(`${addresses[i]}: ${res.data.length} txns`));
```

### Rate-limit-aware batching

```js
async function batchFetch(items, fn, batchSize = 4, delayMs = 250) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + batchSize < items.length) await new Promise(r => setTimeout(r, delayMs));
  }
  return results;
}
```

### Script Constraints

- **30s timeout** — scripts are killed after 30 seconds
- **100KB output limit** — filter/aggregate data before printing
- **No filesystem access** — cannot read/write files
- **No npm modules** — only built-in globals and fetch()
- **Minimal env** — only `process.env.API_URL` is available
