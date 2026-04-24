# Graph Mutations via Scripts

Add, edit, and delete wallet nodes, transaction edges, and groups in the investigation graph by writing scripts that call the backend API.

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
| `fromLabel` | string | no | Human-readable label for the sender node (e.g. "Wintermute", "Justin Sun") |
| `toLabel` | string | no | Human-readable label for the receiver node |

### Response

```json
{ "added": { "nodes": 3, "edges": 5 } }
```

The endpoint auto-creates wallet nodes for addresses not already in the graph. Deduplication is by `{txHash}-{from}-{to}`, so calling it multiple times with the same data is safe.

**Cross-trace edges are handled automatically.** If an address in the transaction already exists as a node in a *different* trace of the same investigation, the endpoint will link to that existing node instead of creating a duplicate, and mark the edge as `crossTrace: true`. This means you can create connections between nodes in different traces simply by importing the transaction into either trace — no special handling needed.

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

// 2. Map to import format (fromLabel/toLabel are optional — set when you know the identity)
const transactions = txns.map(tx => ({
  from: tx.from,
  to: tx.to,
  txHash: tx.hash,
  chain: 'ethereum',
  timestamp: tx.timeStamp,
  amount: (Number(tx.value) / 1e18).toString(),
  token: 'ETH',
  blockNumber: Number(tx.blockNumber),
  // fromLabel: 'Wintermute',  // optional — labels the sender node on creation
  // toLabel: 'Justin Sun',    // optional — labels the receiver node on creation
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

## Create a Group

Groups visually cluster nodes within a trace. Use `get_case_data` to find node IDs first.

```
POST {API_URL}/traces/{traceId}/groups
Content-Type: application/json
```

```json
{
  "name": "Tron Foundation Wallets",
  "color": "#f59e0b",
  "collapsed": false,
  "nodeIds": ["existing-node-id-1", "existing-node-id-2"],
  "newNodes": [
    { "address": "0xABC123...", "chain": "ethereum", "label": "Justin Sun" },
    { "address": "TRX789...", "chain": "tron", "label": "Tron Reserve", "color": "#f59e0b" }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Display name for the group |
| `nodeIds` | no | IDs of existing nodes to include in the group |
| `newNodes` | no | New wallet nodes to create and add to the group in one step |
| `color` | no | Hex color for the group border/background |
| `collapsed` | no | Start collapsed (default false) |

**`newNodes` fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `address` | yes | Wallet address |
| `chain` | yes | Chain (ethereum, polygon, arbitrum, base, tron) |
| `label` | no | Human-readable name (e.g. "Justin Sun") |
| `color` | no | Hex color |
| `shape` | no | `"ellipse"` (default), `"rectangle"`, `"roundrectangle"`, `"diamond"`, `"hexagon"`, `"triangle"` |
| `notes` | no | Notes |

If a `newNodes` address already exists in the trace, it's added to the group without creating a duplicate. You can use `nodeIds`, `newNodes`, or both together.

Returns the group object including its `id` and final `nodeIds` list.

## Update a Group

```
PATCH {API_URL}/traces/{traceId}/groups/{groupId}
Content-Type: application/json
```

All fields optional:

```json
{ "name": "New Name", "color": "#10b981", "collapsed": true }
```

## Delete a Group

```
DELETE {API_URL}/traces/{traceId}/groups/{groupId}
```

Returns `204 No Content`. Nodes that were in the group are preserved — only the grouping is removed.

## Edit a Node

```
PATCH {API_URL}/traces/{traceId}/nodes/{nodeId}
Content-Type: application/json
```

All fields optional — only send what you want to change:

```json
{
  "label": "Justin Sun",
  "color": "#f59e0b",
  "size": 60,
  "shape": "diamond",
  "notes": "Tron founder",
  "tags": ["person", "exchange"]
}
```

| Field | Description |
|-------|-------------|
| `label` | Display name |
| `color` | Hex color |
| `size` | Node size (default ~40) |
| `shape` | `"ellipse"` (default/circle), `"rectangle"`, `"roundrectangle"`, `"diamond"`, `"hexagon"`, `"triangle"` |
| `notes` | Free-text notes |
| `tags` | Array of tag strings |

Returns the updated node object. The `nodeId` comes from `get_case_data`.

## Edit an Edge

```
PATCH {API_URL}/traces/{traceId}/edges/{edgeId}
Content-Type: application/json
```

All fields optional — only send what you want to change:

```json
{
  "label": "Suspicious transfer",
  "color": "#ef4444",
  "lineStyle": "dashed",
  "notes": "Possible layering step — funds moved within 2 hours of receipt",
  "tags": ["suspicious", "layering"]
}
```

| Field | Description |
|-------|-------------|
| `label` | Display name shown on the edge (free text; overrides amount+token display) |
| `color` | Hex color for the edge line |
| `lineStyle` | `"solid"` (default), `"dashed"`, or `"dotted"` |
| `timestamp` | ISO 8601 string or unix seconds string e.g. `"1742317655"` or `"2025-03-18T00:00:00Z"` |
| `notes` | Free-text notes about this transaction |
| `tags` | Array of tag strings |

Returns the updated edge object. The `edgeId` comes from `get_case_data`.

## Delete an Edge

```
DELETE {API_URL}/traces/{traceId}/edges/{edgeId}
```

Returns `204 No Content`. Also removes the edge from any edge bundles that reference it (and deletes the bundle entirely if it becomes empty).

## Delete a Node

```
DELETE {API_URL}/traces/{traceId}/nodes/{nodeId}
```

Returns `204 No Content`. Also removes all edges connected to that node within the trace.

## List Edge Bundles

```
GET {API_URL}/traces/{traceId}/bundles
```

Returns an array of edge bundle objects for the trace. Each bundle has `id`, `traceId`, `fromNodeId`, `toNodeId`, `token`, `collapsed`, `edgeIds[]`, and optional `color`. Use this to discover bundle IDs before deleting them.

## Delete an Edge Bundle

```
DELETE {API_URL}/traces/{traceId}/bundles/{bundleId}
```

Returns `204 No Content`. Removes only the bundle metadata — the underlying edges are preserved. Use this to clean up broken, duplicate, or unwanted bundles without losing transaction data.

## Tips

- Use `get_case_data` first to find the `traceId` for the target trace.
- Deduplication is built in — safe to import overlapping data.
- For large datasets (hundreds of transactions), batch into chunks of ~100 per POST call.
- Load the `blockchain-apis` skill for exact Etherscan/Tronscan endpoint formats.
- For token transfers, use `account/tokentx` and map `tokenSymbol` to the `token` field.
- Convert wei/sun to human-readable amounts before importing (÷ 10^decimals).
