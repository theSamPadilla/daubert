---
name: solana-apis
description: Helius parsed-transaction API reference (mainnet.helius-rpc.com) for Solana address and transaction queries
---

# Helius (Solana)

**Host:** `https://mainnet.helius-rpc.com`

> **API keys are injected automatically.** Do not include `api-key` in your query parameters — the sandbox adds it for you.

> **Address sanity check before querying:** an address starting with `1`, `3`, or `bc1` is **Bitcoin, not Solana** — legacy Bitcoin addresses are shape-valid base58 and look exactly like Solana pubkeys. Use the `bitcoin-apis` skill (Esplora) for those. Only bare base58 strings (32-44 chars) matching no other chain's shape are Solana.

## Endpoints

### `GET /v0/addresses/:address/transactions`
Parsed transaction history, newest-first, **up to 100 per page**, cursor-paginated.

| Param | Required | Description |
|-------|----------|--------------|
| `limit` | no | Page size, max 100 (default 100) |
| `before-signature` | no | Cursor — pass the last tx's `signature` from the previous page to get the next one |

Omit `before-signature` for the first page. A page shorter than `limit` means you've reached the end.

### `POST /v0/transactions`
Parse a specific transaction by signature.

Body: `{ "transactions": ["<signature>"] }` — returns an array (parse the first element; Helius returns one entry per signature requested).

### JSON-RPC `getAssetBatch`
Mint metadata (symbol, decimals) for SPL tokens. `POST` to the host root (`/`) with a standard JSON-RPC envelope:

```json
{ "jsonrpc": "2.0", "id": "1", "method": "getAssetBatch", "params": { "ids": ["<mint>", "<mint>", ...] } }
```

Response: `result[]`, one entry per requested mint in the same order, each with `token_info: { symbol, decimals }` (absent/null entries mean the mint didn't resolve — treat as unknown, decimals `0`).

Shared parsed-transaction shape (`GET /v0/addresses/:address/transactions` and `POST /v0/transactions` both return this):

```json
{
  "signature": "5abc...",
  "timestamp": 1710000000,
  "slot": 250000000,
  "fee": 5000,
  "feePayer": "SoL...",
  "type": "TRANSFER",
  "source": "SYSTEM_PROGRAM",
  "transactionError": null,
  "nativeTransfers": [
    { "fromUserAccount": "SoL...", "toUserAccount": "SoL...", "amount": 1000000 }
  ],
  "tokenTransfers": [
    {
      "fromUserAccount": "SoL...", "toUserAccount": "SoL...",
      "fromTokenAccount": "ATA...", "toTokenAccount": "ATA...",
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "tokenAmount": 1.5, "tokenStandard": "Fungible"
    }
  ]
}
```

`nativeTransfers[].amount` is **lamports** (already the raw base unit). `tokenTransfers[].tokenAmount` is **decimal-adjusted** (e.g. `1.5` USDC, not `1500000`) — convert to raw units before importing (see Units, below). Either `fromUserAccount`/`toUserAccount` can be `null` when Helius couldn't resolve an owner — never invent one; see "Never synthesize a counterparty" below. A transaction with `transactionError !== null` moved nothing — skip it entirely.

### Pagination loop example

```js
async function fetchAllTxs(address, maxTotal = 300) {
  const txs = [];
  let before;
  for (;;) {
    const qs = new URLSearchParams({ limit: '100', ...(before ? { 'before-signature': before } : {}) });
    const res = await fetch(`https://mainnet.helius-rpc.com/v0/addresses/${address}/transactions?${qs}`);
    if (!res.ok) throw new Error(`Helius error ${res.status}`);
    const page = await res.json();
    if (page.length === 0) break;
    txs.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < 100 || txs.length >= maxTotal) break; // partial page = last page
  }
  return txs.slice(0, maxTotal);
}
```

## Units

Helius returns **lamports** for native transfers (`nativeTransfers[].amount`) — already the raw base unit, no conversion needed. Helius returns **decimal-adjusted** amounts for SPL transfers (`tokenTransfers[].tokenAmount`) — e.g. `1.5` for USDC, not `1500000`.

The import contract inverts this for `solana` rows: any `ImportTransactionItem` that carries a `solana` block uses **raw base units** for `amount` — lamports for `kind: 'native'`, raw token units (decimal amount × 10^decimals) for `kind: 'spl'` — never the human-readable value Helius returns for token transfers. Only a **bare** Solana import (no `solana` block — not recommended, see below) uses decimal SOL/token amounts, matching the human-readable convention every other chain uses in `amount`.

Always prefer sending the `solana` block. A bare Solana row throws away the transfer-level evidence (`transferIndex`, mint, token accounts, spam signal) that makes Solana tracing defensible — use it only if you truly don't have the raw Helius transfer (e.g. hand-entering a single known tx without a Helius lookup).

**Convert with string math, not floating point.** `1.1 * 1e18`-style multiplication loses precision on large or high-decimal amounts, and these numbers end up in court exhibits. Shift the decimal point on the string representation instead (see `decimalToRaw` in the script example below).

## The `solana` payload

`ImportTransactionItem.solana` (same shape as `TransactionResult.solana`, contract `SolanaContext` in `contracts/schemas/blockchain.yaml`):

| Field | Required | Description |
|-------|----------|--------------|
| `transferIndex` | yes | Position of this transfer in `[...nativeTransfers, ...tokenTransfers]` for the transaction — natives first, tokens after, in Helius's own array order. This is the edge identity (see below). |
| `feePayer` | yes | Address that paid the transaction fee |
| `kind` | yes | `'native'` (SOL) or `'spl'` (SPL token) |
| `mint` | SPL only | Token mint address |
| `decimals` | SPL only | Token decimals (native SOL is 9, implied by the `token` object) |
| `fromTokenAccount` | SPL only | Sender's token account (ATA) — raw evidentiary detail distinct from the owner wallet |
| `toTokenAccount` | SPL only | Receiver's token account (ATA) |
| `type` | no | Helius transaction type classification (e.g. `TRANSFER`, `SWAP`) |
| `source` | no | Helius source-program classification (e.g. `JUPITER`, `SYSTEM_PROGRAM`) |
| `slot` | no | Solana slot number |
| `spam` | no | Spam verdict — present only on incoming SPL transfers where at least one heuristic fired |
| `spamEvidence` | no | Array of heuristic labels that fired: `unsolicited`, `unknown-mint`, `mass-distribution` |

### Edge identity: `transferIndex`

Unlike Bitcoin, Solana's account model names both endpoints of every transfer outright — there's no attribution problem, so there's no junction-node escape hatch. What Solana needs instead is a stable identity for the transfer itself: a single signature can carry many transfers (native and SPL, in one instruction or several), and refetching the same address history must recognize the same transfer as the same fact rather than create a duplicate edge.

`transferIndex` is that identity, combined with the signature: **`${signature}:sol:${transferIndex}`**. It must be the transfer's raw position in the full `[...nativeTransfers, ...tokenTransfers]` array — never the count of rows you've emitted so far. Skipping a zero-amount or unresolvable transfer must not shift the indices of the ones after it, or re-imports will mint duplicate edges instead of recognizing the same transfer.

### Never synthesize a counterparty

**Only emit a row when the ledger names both `fromUserAccount` and `toUserAccount`, and at least one of them is the subject address.** A transfer with a null (or empty-string) owner — Helius couldn't resolve it — produces no row, not a row with a blank `from`/`to`. Declining to invent a party is correct behavior, not a bug to work around.

### Spam: flagged, never hidden

Spam is evaluated only for **incoming SPL token transfers** — native SOL transfers and outgoing rows never carry `spam`/`spamEvidence` at all. Three independent heuristics, each recorded in `spamEvidence` when it fires:

- `unsolicited` — the subject received the transfer, didn't send anything elsewhere in the same transaction (native or token), and didn't pay the transaction fee.
- `unknown-mint` — the mint isn't one of the three hand-verified majors (USDC, USDT, wSOL) and upstream mint-metadata resolution failed.
- `mass-distribution` — the transaction fans out to 10+ distinct token recipients (bulk-airdrop shape).

`spam` is `true` only when `unsolicited` **and** (`unknown-mint` **or** `mass-distribution`) — an unsolicited transfer of a known, resolved mint to a handful of recipients is not flagged.

**Agents must never delete, hide, or silently drop a flagged row.** Import it like any other transfer, evidence and all — the investigator decides what a flagged transfer means, not the script. The job of `spam`/`spamEvidence` is to inform, not to filter.

## Full script example

Fetches an address's transaction history from Helius, resolves SPL mint metadata, builds `ImportTransactionItem[]` (raw base-unit amounts, per-transfer `solana` context, spam evidence on flagged incoming SPL rows), and imports it into a trace.

```js
const API_URL = process.env.API_URL;
const TRACE_ID = 'TRACE_ID_HERE';
const ADDRESS = 'SoLTARGETaddress...';

const HELIUS_HOST = 'https://mainnet.helius-rpc.com';

async function helius(path, opts = {}) {
  const res = await fetch(`${HELIUS_HOST}${path}`, opts);
  if (!res.ok) throw new Error(`Helius error ${res.status} on ${path}`);
  return res.json();
}

async function fetchAllTxs(address, maxTotal = 300) {
  const txs = [];
  let before;
  for (;;) {
    const qs = new URLSearchParams({ limit: '100', ...(before ? { 'before-signature': before } : {}) });
    const page = await helius(`/v0/addresses/${address}/transactions?${qs}`);
    if (page.length === 0) break;
    txs.push(...page);
    before = page[page.length - 1].signature;
    if (page.length < 100 || txs.length >= maxTotal) break;
  }
  return txs.slice(0, maxTotal);
}

// Raw base-unit conversion via string math — never floating point (these
// amounts end up in court exhibits).
function decimalToRaw(amount, decimals) {
  const plain = String(amount);
  const negative = plain.startsWith('-');
  const unsigned = negative ? plain.slice(1) : plain;
  const [intPart = '', fracPart = ''] = unsigned.split('.');
  const scaledFrac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const digits = (intPart + scaledFrac).replace(/^0+/, '');
  const raw = digits === '' ? '0' : digits;
  return negative && raw !== '0' ? `-${raw}` : raw;
}

function isZero(amount) {
  return /^0*$/.test(String(amount).replace('-', '').replace('.', ''));
}

// Never synthesize a counterparty — both ends must be named by the ledger,
// and at least one must be the subject address.
function resolveEndpoints(transfer) {
  const { fromUserAccount: from, toUserAccount: to } = transfer;
  if (!from || !to) return null;
  if (from !== ADDRESS && to !== ADDRESS) return null;
  return { from, to };
}

const KNOWN_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112', // wSOL
]);
const MASS_DISTRIBUTION_MIN_RECIPIENTS = 10;

function detectSpam(tx, transfer, mintResolved) {
  const evidence = [];
  const sentElsewhere =
    tx.nativeTransfers.some((t) => t.fromUserAccount === ADDRESS) ||
    tx.tokenTransfers.some((t) => t.fromUserAccount === ADDRESS);
  const unsolicited = transfer.toUserAccount === ADDRESS && !sentElsewhere && tx.feePayer !== ADDRESS;
  if (unsolicited) evidence.push('unsolicited');

  const unknownMint = !KNOWN_MINTS.has(transfer.mint) && !mintResolved;
  if (unknownMint) evidence.push('unknown-mint');

  const distinctRecipients = new Set(tx.tokenTransfers.map((t) => t.toUserAccount).filter(Boolean));
  if (distinctRecipients.size >= MASS_DISTRIBUTION_MIN_RECIPIENTS) evidence.push('mass-distribution');

  const spam = unsolicited && (evidence.includes('unknown-mint') || evidence.includes('mass-distribution'));
  return { spam, evidence };
}

// 1. Fetch transactions, then resolve mint metadata for every SPL mint touched.
const txs = await fetchAllTxs(ADDRESS);
const mints = new Set();
for (const tx of txs) for (const t of tx.tokenTransfers) mints.add(t.mint);

const mintMeta = new Map();
if (mints.size > 0) {
  const rpcRes = await helius('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'getAssetBatch', params: { ids: [...mints] } }),
  });
  const assets = rpcRes.result ?? [];
  [...mints].forEach((mint, i) => {
    const info = assets[i]?.token_info;
    mintMeta.set(
      mint,
      info
        ? { symbol: info.symbol ?? `${mint.slice(0, 4)}…`, decimals: info.decimals ?? 0 }
        : { symbol: `${mint.slice(0, 4)}…`, decimals: 0 },
    );
  });
}

// 2. Map each transfer to an import row. transferIndex spans natives then
//    tokens as ONE sequence per tx — it's the edge identity, so it must be
//    the transfer's position in the tx, never the count of rows emitted.
const rows = [];
for (const tx of txs) {
  if (tx.transactionError != null) continue; // failed tx moved nothing
  const timestamp = new Date(tx.timestamp * 1000).toISOString();

  tx.nativeTransfers.forEach((transfer, i) => {
    const endpoints = resolveEndpoints(transfer);
    if (!endpoints || isZero(transfer.amount)) return;
    rows.push({
      from: endpoints.from,
      to: endpoints.to,
      txHash: tx.signature,
      chain: 'solana',
      timestamp,
      amount: decimalToRaw(transfer.amount, 0), // lamports are already raw
      token: 'SOL',
      blockNumber: tx.slot,
      solana: {
        transferIndex: i,
        feePayer: tx.feePayer,
        kind: 'native',
        type: tx.type,
        source: tx.source,
        slot: tx.slot,
      },
    });
  });

  const offset = tx.nativeTransfers.length;
  tx.tokenTransfers.forEach((transfer, i) => {
    const endpoints = resolveEndpoints(transfer);
    if (!endpoints || isZero(transfer.tokenAmount)) return;

    const meta = mintMeta.get(transfer.mint);
    const mintResolved = meta !== undefined;
    const symbol = meta?.symbol ?? `${transfer.mint.slice(0, 4)}…`;
    const decimals = meta?.decimals ?? 0;

    const solana = {
      transferIndex: offset + i,
      feePayer: tx.feePayer,
      kind: 'spl',
      mint: transfer.mint,
      decimals,
      fromTokenAccount: transfer.fromTokenAccount ?? undefined,
      toTokenAccount: transfer.toTokenAccount ?? undefined,
      type: tx.type,
      source: tx.source,
      slot: tx.slot,
    };

    // Spam is only assessed for incoming SPL transfers.
    if (endpoints.to === ADDRESS && endpoints.from !== ADDRESS) {
      const verdict = detectSpam(tx, transfer, mintResolved);
      if (verdict.evidence.length > 0) {
        solana.spam = verdict.spam;
        solana.spamEvidence = verdict.evidence;
      }
    }

    rows.push({
      from: endpoints.from,
      to: endpoints.to,
      txHash: tx.signature,
      chain: 'solana',
      timestamp,
      amount: decimalToRaw(transfer.tokenAmount, decimals),
      token: symbol,
      blockNumber: tx.slot,
      solana,
    });
  });
}

// 3. POST to the import endpoint in batches of ~100.
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

## Don't log raw Helius payloads

A DEX swap or bulk-distribution transaction can carry many `tokenTransfers` at once — `console.log(JSON.stringify(tx))` on a batch of these can eat into the **100KB script output cap**. Log counts and aggregates instead:

```js
console.log(`${txs.length} txs fetched, ${rows.length} import rows built`);
console.log(`flagged spam: ${rows.filter((r) => r.solana?.spam).length}`);
```

If you need to inspect one transaction while debugging, log a summary (`{ signature: tx.signature, nativeCount: tx.nativeTransfers.length, tokenCount: tx.tokenTransfers.length, type: tx.type }`), not the full object.

### Script Constraints

- **30s timeout** — scripts are killed after 30 seconds
- **100KB output limit** — filter/aggregate data before printing
- **No filesystem access** — cannot read/write files
- **No npm modules** — only built-in globals and fetch()
- **Minimal env** — only `process.env.API_URL` is available
