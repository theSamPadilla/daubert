# Blockchain API Reference

Use this reference to construct direct API calls via `web_search` or when advising the investigator on API queries. If an endpoint isn't listed here, fall back to `web_search` to find current documentation.

---

## Etherscan V2 (EVM Chains)

**Base URL:** `https://api.etherscan.io/v2/api?chainid={CHAIN_ID}&module={MODULE}&action={ACTION}`

> **API keys are injected automatically.** Do not include `apikey` in your query parameters — the sandbox adds it for you.

### Supported Chain IDs

| Chain     | ID     |
|-----------|--------|
| Ethereum  | 1      |
| Polygon   | 137    |
| Arbitrum  | 42161  |
| Base      | 8453   |
| Optimism  | 10     |
| BSC       | 56     |
| Avalanche | 43114  |

### Endpoints

#### account / balance
Wallet balance in wei. Supports multi-address with comma-separated list (up to 20).

| Param   | Required | Description            |
|---------|----------|------------------------|
| address | yes      | Wallet address(es)     |
| tag     | no       | `latest` (default)     |

Key response: `result` — balance string (wei) or array of `{account, balance}` for multi.

#### account / txlist
Normal (external) transaction history.

| Param      | Required | Description                     |
|------------|----------|---------------------------------|
| address    | yes      | Wallet address                  |
| startblock | no       | Start block (default 0)         |
| endblock   | no       | End block (default 99999999)    |
| page       | no       | Page number                     |
| offset     | no       | Results per page (max 10000)    |
| sort       | no       | `asc` or `desc`                 |

Key response fields: `hash`, `from`, `to`, `value` (wei), `timeStamp`, `blockNumber`, `gas`, `gasUsed`, `isError`, `input`, `contractAddress`.

#### account / txlistinternal
Internal (trace) transactions.

Same params as `txlist`. Key response fields: `hash`, `from`, `to`, `value`, `type`, `traceId`, `isError`.

#### account / tokentx
ERC-20 token transfers.

Same params as `txlist`, plus optional `contractaddress` to filter by token. Key response fields: `hash`, `from`, `to`, `value`, `tokenName`, `tokenSymbol`, `tokenDecimal`, `contractAddress`.

#### account / tokennfttx
ERC-721 (NFT) transfers.

Same params as `tokentx`. Key response fields: `hash`, `from`, `to`, `tokenID`, `tokenName`, `tokenSymbol`, `contractAddress`.

#### account / token1155tx
ERC-1155 transfers.

Same params as `tokentx`. Key response fields: `hash`, `from`, `to`, `tokenID`, `tokenValue`, `tokenName`, `tokenSymbol`, `contractAddress`.

#### account / tokenbalance
Specific token balance for address.

| Param           | Required | Description       |
|-----------------|----------|-------------------|
| address         | yes      | Wallet address    |
| contractaddress | yes      | Token contract    |
| tag             | no       | `latest`          |

Key response: `result` — balance string in token's smallest unit.

#### contract / getabi
ABI for a verified contract.

| Param   | Required | Description       |
|---------|----------|-------------------|
| address | yes      | Contract address  |

Key response: `result` — JSON string of the ABI array.

#### contract / getsourcecode
Contract source code + metadata.

| Param   | Required | Description       |
|---------|----------|-------------------|
| address | yes      | Contract address  |

Key response: array with `SourceCode`, `ABI`, `ContractName`, `CompilerVersion`, `Proxy`, `Implementation`.

#### contract / getcontractcreation
Deployer address and creation tx.

| Param            | Required | Description                        |
|------------------|----------|------------------------------------|
| contractaddresses | yes     | Comma-separated contract addresses (up to 5) |

Key response: array of `{contractAddress, contractCreator, txHash}`.

#### gastracker / gasoracle
Current gas prices.

No additional params. Key response: `{SafeGasPrice, ProposeGasPrice, FastGasPrice, suggestBaseFee}`.

#### stats / ethprice
Current ETH/USD and ETH/BTC price.

No additional params. Key response: `{ethbtc, ethbtc_timestamp, ethusd, ethusd_timestamp}`.

### Pagination
- Use `page` + `offset` params. Max `offset` is 10000.
- If result count equals `offset`, there may be more pages.

### Rate Limits
- Free tier: 5 calls/sec. Pro: higher.
- The app applies its own rate limiter; avoid suggesting rapid sequential calls.

---

## Tronscan API

**Base URL:** `https://apilist.tronscanapi.com/api`

> **Auth header is injected automatically.** Do not include `TRON-PRO-API-KEY` in your headers — the sandbox adds it for you.

### Endpoints

#### accountv2
Account detail including TRX balance, bandwidth, energy.

| Param   | Required | Description       |
|---------|----------|-------------------|
| address | yes      | TRON address      |

Key response: `balance` (sun), `bandwidth`, `tokens[]`, `frozen`, `representative`.

#### account/tokens
Token holdings for an account.

| Param   | Required | Description       |
|---------|----------|-------------------|
| address | yes      | TRON address      |
| start   | no       | Offset (default 0)|
| limit   | no       | Page size         |

Key response: `data[]` with `{tokenId, tokenAbbr, tokenName, balance, tokenDecimal, tokenType}`.

#### transaction
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

#### transaction-info
Transaction detail by hash.

| Param | Required | Description       |
|-------|----------|-------------------|
| hash  | yes      | Transaction hash  |

Key response: `{hash, block, timestamp, ownerAddress, toAddress, contractData, confirmed, contractRet}`.

#### transfer
TRX and TRC10 transfers.

| Param   | Required | Description              |
|---------|----------|--------------------------|
| address | yes      | TRON address             |
| start   | no       | Offset                   |
| limit   | no       | Page size                |
| sort    | no       | `timestamp` or `-timestamp` |

Key response: `data[]` with `{transactionHash, transferFromAddress, transferToAddress, amount, confirmed, block, timestamp, tokenInfo}`.

#### token_trc20/transfers
TRC-20 token transfers.

| Param          | Required | Description           |
|----------------|----------|-----------------------|
| relatedAddress | yes      | TRON address          |
| start          | no       | Offset                |
| limit          | no       | Page size             |
| sort           | no       | `timestamp` or `-timestamp` |

Key response: `token_transfers[]` with `{transaction_id, from_address, to_address, quant, block_ts, tokenInfo{tokenId, tokenAbbr, tokenName, tokenDecimal}}`.

#### contract
Contract detail.

| Param   | Required | Description       |
|---------|----------|-------------------|
| contract | yes     | Contract address  |

Key response: `{address, name, creator, balance, trxCount, tokenInfo}`.

#### token/price
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

## TronGrid v1

**Base URL:** `https://api.trongrid.io`

> **Auth header is injected automatically** (same as Tronscan).

### Endpoints

#### v1/accounts/{address}
Account info (balance, permissions, resources).

Key response: `data[0]` with `{address, balance, create_time, trc20[]}`.

#### v1/accounts/{address}/transactions
Transaction history.

| Param          | Required | Description              |
|----------------|----------|--------------------------|
| limit          | no       | Page size (default 20, max 200) |
| fingerprint    | no       | Cursor for next page     |
| only_confirmed | no       | `true` for confirmed only |
| min_timestamp  | no       | Filter start (ms)        |
| max_timestamp  | no       | Filter end (ms)          |

Key response: `data[]` transactions, `meta.fingerprint` for pagination.

#### v1/accounts/{address}/transactions/trc20
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

- **Wei conversion:** EVM amounts are in wei (÷ 10^18 for ETH, ÷ 10^decimals for tokens).
- **Sun conversion:** TRON amounts are in sun (÷ 10^6 for TRX).
- **Address formats:** EVM = `0x...` (hex, case-insensitive). TRON = `T...` (base58, case-sensitive).
- **Timestamps:** Etherscan returns Unix seconds. Tronscan/TronGrid return Unix milliseconds.
- If you need an endpoint not listed here, use `web_search` to find the current API documentation.

---

## Script Execution Patterns

Use these patterns with the `execute_script` tool. Scripts run in a sandboxed V8 isolate with top-level await.

> **API keys are injected automatically by the sandbox.** Do not read them from `process.env` or include them in URLs/headers. The only env var available is `process.env.API_URL` (the backend base URL for graph mutations).

### Etherscan fetch helper

```js
async function etherscan(chainId, module, action, params = {}) {
  const qs = new URLSearchParams({ chainid: chainId, module, action, ...params });
  const res = await fetch(`https://api.etherscan.io/v2/api?${qs}`);
  const json = await res.json();
  if (json.status === '0' && json.message !== 'No transactions found') throw new Error(json.result);
  return json.result;
}
```

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
const addresses = ['0xabc...', '0xdef...', '0x123...'];
const results = await Promise.all(
  addresses.map(addr => etherscan('1', 'account', 'txlist', { address: addr, page: '1', offset: '100', sort: 'desc' }))
);
results.forEach((txns, i) => console.log(`${addresses[i]}: ${txns.length} txns`));
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

### Constraints

- **30s timeout** — scripts are killed after 30 seconds
- **100KB output limit** — filter/aggregate data before printing
- **No filesystem access** — cannot read/write files
- **No npm modules** — only Node.js built-ins and global fetch()
- **Minimal env** — only API key env vars are available
