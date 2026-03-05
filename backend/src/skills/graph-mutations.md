# Graph Mutations via Scripts

Add wallet nodes and transaction edges to the investigation graph by writing a script that fetches blockchain data and POSTs to the import endpoint.

## Import Endpoint

```
POST {API_URL}/traces/{traceId}/import-transactions
Content-Type: application/json
```

### Request Body

```json
{
  "transactions": [
    {
      "from": "0xSenderAddress",
      "to": "0xReceiverAddress",
      "txHash": "0xTransactionHash",
      "chain": "ethereum",
      "timestamp": "1709500000",
      "amount": "1.5",
      "token": "ETH",
      "blockNumber": 19000000
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | yes | Sender address |
| `to` | string | yes | Receiver address |
| `txHash` | string | yes | Transaction hash |
| `chain` | string | yes | Chain identifier (ethereum, polygon, arbitrum, base, tron) |
| `timestamp` | string | yes | Unix timestamp (seconds for EVM, milliseconds for Tron) |
| `amount` | string | yes | Human-readable amount (already divided by decimals) |
| `token` | string | yes | Token symbol (e.g. "ETH", "USDT", "TRX") |
| `blockNumber` | number | no | Block number |

### Response

```json
{ "added": { "nodes": 3, "edges": 5 } }
```

The endpoint auto-creates wallet nodes for addresses not already in the graph. Deduplication is by `{txHash}-{from}-{to}`, so calling it multiple times with the same data is safe.

## Native Currency Tokens

| Chain | Token Symbol |
|-------|-------------|
| Ethereum | ETH |
| Polygon | MATIC |
| Arbitrum | ETH |
| Base | ETH |
| Tron | TRX |

For ERC-20/TRC-20 tokens, use the token symbol from the API response (e.g. "USDT", "USDC").

## Script Pattern

```js
const API_URL = process.env.API_URL;
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const TRACE_ID = 'TRACE_ID_HERE'; // from get_case_data

// 1. Fetch transactions from Etherscan
const qs = new URLSearchParams({
  chainid: '1', module: 'account', action: 'txlist',
  address: '0xTARGET', page: '1', offset: '100', sort: 'desc',
  apikey: ETHERSCAN_KEY,
});
const res = await fetch(`https://api.etherscan.io/v2/api?${qs}`);
const json = await res.json();
const txns = json.result;

// 2. Map to import format
const transactions = txns.map(tx => ({
  from: tx.from,
  to: tx.to,
  txHash: tx.hash,
  chain: 'ethereum',
  timestamp: tx.timeStamp,
  amount: (Number(tx.value) / 1e18).toString(),
  token: 'ETH',
  blockNumber: Number(tx.blockNumber),
}));

// 3. POST to import endpoint
const importRes = await fetch(`${API_URL}/traces/${TRACE_ID}/import-transactions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ transactions }),
});
const result = await importRes.json();
console.log(`Imported: ${result.added.nodes} nodes, ${result.added.edges} edges`);
```

## Tips

- Use `get_case_data` first to find the `traceId` for the target trace.
- Deduplication is built in — safe to import overlapping data.
- For large datasets (hundreds of transactions), batch into chunks of ~100 per POST call.
- Load the `blockchain-apis` skill for exact Etherscan/Tronscan endpoint formats.
- For token transfers, use `account/tokentx` and map `tokenSymbol` to the `token` field.
- Convert wei/sun to human-readable amounts before importing (÷ 10^decimals).
