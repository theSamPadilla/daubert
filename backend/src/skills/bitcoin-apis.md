---
name: bitcoin-apis
description: Esplora API reference (mempool.space, blockstream.info) for Bitcoin UTXO address and transaction queries
---

# Esplora (Bitcoin)

**Primary host:** `https://mempool.space/api`
**Failover host:** `https://blockstream.info/api` (mempool.space's electrs is a fork of Blockstream's esplora — same endpoint shapes)

> **No API key.** Both hosts are keyless at MVP volume — nothing is injected by the sandbox for Bitcoin. Just `fetch()` the URL directly.

If the primary host errors (network failure, 429, or any 5xx), retry the same path on the failover host. Other 4xx statuses (400/404/...) are not worth retrying — they'll fail identically on both hosts.

## Endpoints

### `GET /address/:address`
Address balance/activity summary.

Key response:
```json
{
  "address": "bc1q...",
  "chain_stats": { "funded_txo_sum": 123456, "spent_txo_sum": 100000, "tx_count": 12 },
  "mempool_stats": { "funded_txo_sum": 0, "spent_txo_sum": 0, "tx_count": 0 }
}
```
Balance (sats) = `chain_stats.funded_txo_sum - chain_stats.spent_txo_sum`.

### `GET /address/:address/txs/chain[/:last_seen_txid]`
Confirmed transaction history, newest-first, **25 per page**, cursor-paginated. Omit `:last_seen_txid` for the first page; pass the last tx's `txid` from the previous page to get the next one. A page shorter than 25 means you've reached the end.

### `GET /address/:address/txs/mempool`
Unconfirmed transactions for the address. No pagination (mempool contents are small and volatile) — don't cache this call, the contents change constantly.

### `GET /tx/:txid`
Single transaction detail, with **resolved `vin[].prevout`** — you get the input's paying address, script type, and value without a second lookup.

Shared transaction shape (`address stats` aside, everything above returns transactions in this shape):

```json
{
  "txid": "...",
  "fee": 1360,
  "vin": [
    {
      "txid": "<prev txid>",
      "vout": 0,
      "is_coinbase": false,
      "prevout": {
        "scriptpubkey_address": "bc1q...",
        "scriptpubkey_type": "v0_p2wpkh",
        "value": 5000000
      }
    }
  ],
  "vout": [
    {
      "scriptpubkey_address": "bc1q...",
      "scriptpubkey_type": "v0_p2wpkh",
      "value": 4998640
    }
  ],
  "status": { "confirmed": true, "block_height": 820000, "block_time": 1700000000 }
}
```

`prevout` is `null` for coinbase inputs. `scriptpubkey_address` is absent for non-standard scripts and for `op_return` outputs.

### Pagination loop example

```js
async function fetchAllConfirmed(address, maxTotal = 300) {
  const txs = [];
  let cursor;
  for (;;) {
    const page = await esplora(`/address/${address}/txs/chain${cursor ? '/' + cursor : ''}`);
    if (page.length === 0) break;
    txs.push(...page);
    cursor = page[page.length - 1].txid;
    if (page.length < 25 || txs.length >= maxTotal) break; // partial page = last page
  }
  return txs.slice(0, maxTotal);
}
```

## Units

**Everything Esplora returns is in satoshis** (integers): `chain_stats.*_sum`, `vin[].prevout.value`, `vout[].value`, `tx.fee`. There is no decimal BTC anywhere in the Esplora response shape.

The import contract mirrors this: any `ImportTransactionItem` that carries a `utxo` block uses **satoshis as decimal strings** for `amount` and every `utxo.inputs[]/outputs[]` value — never divide by `1e8`. Only a **bare** BTC import (no `utxo` block — not recommended, see below) uses decimal BTC, matching the human-readable convention every other chain uses in `amount`.

Always prefer sending the `utxo` block. A bare BTC row throws away the ledger evidence (inputs/outputs/fee) that makes Bitcoin tracing defensible — use it only if you truly don't have the raw transaction (e.g. hand-entering a single known tx without an Esplora lookup).

## The `utxo` payload and junction semantics

`ImportTransactionItem.utxo` (same shape as `TransactionResult.utxo`, contract `UtxoContext` in `contracts/schemas/blockchain.yaml`):

| Field | Required | Description |
|-------|----------|--------------|
| `inputs[]` | yes | `{ address (nullable), value (sats string), prevTxid, prevVout, scriptType, coinbase }` per `vin` |
| `outputs[]` | yes | `{ address (nullable), value (sats string), index, scriptType, change?, changeEvidence?, opReturn? }` per `vout` |
| `fee` | yes | Satoshis, as a decimal string |
| `warnings` | no | Pattern labels: `possible-coinjoin`, `consolidation`, `coinbase`, `multi-input` |
| `confirmed` | no | From `tx.status.confirmed` |
| `blockHeight` | no | From `tx.status.block_height`, nullable |
| `vout` | no | Which output this row/edge represents (payment rows) |
| `junction` | no | **Set `true` and the server materializes this transaction as a tx-junction node instead of a plain address→address edge.** |

### When to set `junction: true`

The rule is: **never synthesize a sender.** A payment edge asserts "address X paid address Y" — only draw it when the ledger itself names both ends unambiguously. Otherwise the transaction becomes a junction node with one leg edge per real participant. Concretely (mirrors the backend's `mapBtcHistory`):

- The transaction matches a **junction pattern**: `possible-coinjoin` (≥5 inputs, ≥5 outputs, ≥3 outputs share one exact value), `consolidation` (≥5 inputs, ≤2 outputs), or `coinbase` (first input is a coinbase input) — **always** junction, on every row the tx produces.
- **Outgoing** row (subject address is among the inputs): junction if the transaction has **more than 3** non-change, non-`OP_RETURN` payment outputs — a 1-in/2-out payment+change tx is a plain edge, a 10-out batch payout is a junction.
- **Incoming** row (subject address is only among the outputs, not the inputs): junction unless the transaction has **exactly one input** *and* that input's `prevout.scriptpubkey_address` is present — i.e. the ledger names exactly one payer. Any other case (multiple inputs, coinbase, undecodable prevout) is a junction with `from: ''`.

`OP_RETURN` outputs (`scriptpubkey_type === 'op_return'`) never produce a row at all — they pay no one.

## Full script example

Fetches an address's transaction history from Esplora, builds `ImportTransactionItem[]` (satoshi amounts, `token: 'BTC'`, full `utxo` block), and imports it into a trace.

```js
const API_URL = process.env.API_URL;
const TRACE_ID = 'TRACE_ID_HERE';
const ADDRESS = 'bc1qTARGET...';

const ESPLORA_HOSTS = ['https://mempool.space/api', 'https://blockstream.info/api'];

async function esplora(path) {
  let lastErr;
  for (const host of ESPLORA_HOSTS) {
    try {
      const res = await fetch(`${host}${path}`);
      if (res.ok) return res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`Esplora error ${res.status} on ${path}`);
      lastErr = String(res.status);
    } catch (err) {
      lastErr = err.message || String(err);
    }
  }
  throw new Error(`Esplora fetch failed for ${path}: ${lastErr}`);
}

async function fetchAllConfirmed(address, maxTotal = 300) {
  const txs = [];
  let cursor;
  for (;;) {
    const page = await esplora(`/address/${address}/txs/chain${cursor ? '/' + cursor : ''}`);
    if (page.length === 0) break;
    txs.push(...page);
    cursor = page[page.length - 1].txid;
    if (page.length < 25 || txs.length >= maxTotal) break;
  }
  return txs.slice(0, maxTotal);
}

// 1. Fetch: mempool (unconfirmed, prepended) + paginated confirmed history.
const mempoolTxs = await esplora(`/address/${ADDRESS}/txs/mempool`);
const confirmedTxs = await fetchAllConfirmed(ADDRESS);
const txs = [...mempoolTxs, ...confirmedTxs];

// 2. Pattern detection — mirrors the backend's detectPatterns().
const JUNCTION_PATTERNS = ['possible-coinjoin', 'consolidation', 'coinbase'];
const MAX_DIRECT_PAYMENT_OUTPUTS = 3;

function detectPatterns(tx) {
  if (tx.vin[0]?.is_coinbase) return ['coinbase'];
  const patterns = [];
  if (tx.vin.length >= 5 && tx.vout.length >= 5) {
    const counts = new Map();
    for (const o of tx.vout) counts.set(o.value, (counts.get(o.value) || 0) + 1);
    if ([...counts.values()].some((c) => c >= 3)) patterns.push('possible-coinjoin');
  }
  if (tx.vin.length >= 5 && tx.vout.length <= 2) patterns.push('consolidation');
  if (tx.vin.length > 1) patterns.push('multi-input');
  return patterns;
}

// Change heuristic: address-reuse only — an output whose address also
// appears among this transaction's own input addresses. This is the cheap,
// certain half of the backend's detectChange(); the server-side
// fetch_history path (mapBtcHistory) also applies a fuller script-type-match
// + non-round-value heuristic that this script does not replicate. Good
// enough to keep the junction threshold honest; not a substitute for the
// full heuristic if you need it.
function isChangeOutput(tx, out) {
  if (!out.scriptpubkey_address) return false;
  return tx.vin.some((v) => v.prevout?.scriptpubkey_address === out.scriptpubkey_address);
}

function buildUtxo(tx, warnings, extra) {
  return {
    inputs: tx.vin.map((v) => ({
      address: v.prevout?.scriptpubkey_address ?? null,
      value: String(v.prevout?.value ?? 0),
      prevTxid: v.txid,
      prevVout: v.vout,
      scriptType: v.prevout?.scriptpubkey_type,
      coinbase: v.is_coinbase,
    })),
    outputs: tx.vout.map((o, index) => ({
      address: o.scriptpubkey_address ?? null,
      value: String(o.value),
      index,
      scriptType: o.scriptpubkey_type,
      opReturn: o.scriptpubkey_type === 'op_return',
      ...(isChangeOutput(tx, o) ? { change: true, changeEvidence: ['address-reuse'] } : {}),
    })),
    fee: String(tx.fee),
    warnings,
    confirmed: tx.status.confirmed,
    blockHeight: tx.status.block_height ?? null,
    ...extra,
  };
}

// 3. Map each tx to import rows, per the direction + junction rules above.
const rows = [];
for (const tx of txs) {
  const warnings = detectPatterns(tx);
  const txIsJunction = warnings.some((w) => JUNCTION_PATTERNS.includes(w));
  const timestamp = tx.status.confirmed && tx.status.block_time
    ? new Date(tx.status.block_time * 1000).toISOString()
    : new Date().toISOString();
  const blockNumber = tx.status.block_height ?? 0;

  const inInputs = tx.vin.some((v) => v.prevout?.scriptpubkey_address === ADDRESS);
  const inOutputs = tx.vout.some((o) => o.scriptpubkey_address === ADDRESS);

  if (inInputs) {
    // OUTGOING — one row per non-OP_RETURN output (includes change outputs).
    // The >3 threshold counts only NON-CHANGE payment outputs — a normal
    // 1-in/2-out payment+change tx must not be flagged junction just because
    // its change output pushes payable.length past 3.
    const payable = tx.vout.filter((o) => o.scriptpubkey_type !== 'op_return');
    const paymentCount = payable.filter((o) => !isChangeOutput(tx, o)).length;
    const junction = txIsJunction || paymentCount > MAX_DIRECT_PAYMENT_OUTPUTS;
    for (const out of payable) {
      rows.push({
        from: ADDRESS,
        to: out.scriptpubkey_address ?? '',
        txHash: tx.txid,
        chain: 'bitcoin',
        timestamp,
        amount: String(out.value),
        token: 'BTC',
        blockNumber,
        utxo: buildUtxo(tx, warnings, { vout: tx.vout.indexOf(out), junction }),
      });
    }
  } else if (inOutputs) {
    // INCOMING — never synthesize a sender.
    const soleInputAddress = tx.vin.length === 1 ? tx.vin[0].prevout?.scriptpubkey_address : undefined;
    const attributable = !txIsJunction && !!soleInputAddress;
    for (const out of tx.vout.filter((o) => o.scriptpubkey_address === ADDRESS)) {
      rows.push({
        from: attributable ? soleInputAddress : '',
        to: ADDRESS,
        txHash: tx.txid,
        chain: 'bitcoin',
        timestamp,
        amount: String(out.value),
        token: 'BTC',
        blockNumber,
        utxo: buildUtxo(tx, warnings, { vout: tx.vout.indexOf(out), junction: !attributable }),
      });
    }
  }
  // Neither inInputs nor inOutputs: the tx isn't ADDRESS's — skip.
}

// 4. POST to the import endpoint in batches of ~100.
for (let i = 0; i < rows.length; i += 100) {
  const batch = rows.slice(i, i + 100);
  const res = await fetch(`${API_URL}/traces/${TRACE_ID}/import-transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: batch }),
  });
  const result = await res.json();
  console.log(`Batch ${i / 100 + 1}: +${result.added.nodes} nodes, +${result.added.edges} edges`);
}
```

## Don't log raw Esplora payloads

A single CoinJoin or consolidation transaction can have 50+ inputs/outputs — `console.log(JSON.stringify(tx))` on one of those can eat the entire **100KB script output cap** by itself (see Script Constraints below). Log counts and aggregates instead:

```js
console.log(`${txs.length} txs fetched, ${rows.length} import rows built`);
console.log(`junctions: ${rows.filter((r) => r.utxo.junction).length}`);
```

If you need to inspect one transaction while debugging, log a summary (`{ txid, vinCount: tx.vin.length, voutCount: tx.vout.length, fee: tx.fee }`), not the full object.

### Script Constraints

- **30s timeout** — scripts are killed after 30 seconds
- **100KB output limit** — filter/aggregate data before printing
- **No filesystem access** — cannot read/write files
- **No npm modules** — only built-in globals and fetch()
- **Minimal env** — only `process.env.API_URL` is available
