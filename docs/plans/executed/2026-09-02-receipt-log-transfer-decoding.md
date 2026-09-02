# Receipt-Log Transfer Decoding & Contract Classification — Implementation Plan

**Goal:** Make a pasted EVM transaction hash produce the transfer that actually happened — decoded from the receipt logs, with every other leg of the transaction available for the user to switch to, and token contracts classified as ERC-20/721/1155 on chain.

## Summary

**What & why.** Pasting `0xb7a0ee58…` (Polygon) today yields "0 MATIC, `0x51c0…` → `0x07d7…`" — the outer envelope of a contract call, with none of its substance. The real events are in the receipt logs: a 25 USDC payment and an ERC-721 mint. Two independent defects cause this. `etherscan.provider.ts:174` queries `account/tokentx`, which is ERC-20-only, so NFT transfers are structurally invisible; and it queries with `address: tx.from`, the relayer EOA, which is not a party to any transfer in this tx — that query returns **0 results**, verified live. This plan replaces that lookup with a decoder over the receipt we already fetch, adds a cached on-chain classifier for token metadata and standards, and gives the details panel a picker over every decoded leg.

**Key product decisions.**
- **One edge per transaction, defaulting to the primary transfer.** Not one edge per leg — a busy DeFi tx would spray 20+ edges from a single paste.
- **Picking a different leg rewrites the edge** (`from`/`to`/`amount`/`token`/`tokenStandard`) rather than deriving at render time. Every existing consumer — export, aggregation, cytoscape, the agent's view — already reads those fields; deriving would force all of them to learn about legs. The full list is retained as `transfers[]` + `selectedTransferIndex`, so the switch is reversible and the menu persists.
- **Primary = first non-zero leg, preferring one the tx sender is party to.** Deterministic and explainable, which matters when the graph is an exhibit. On the reported tx this selects the 25 USDC payment, leaving the NFT mint and the onward hop in the picker.
- **`addressType` and `tokenStandard` stay separate fields.** `addressType` is an on-chain fact from `eth_getCode`; `'exchange'` is an analyst attribution. Collapsing them into one enum would leave the graph unable to distinguish "the chain says this" from "we decided this" — the distinction that matters when the output is testimony.

**Load-bearing architecture decisions.**
- **Decode receipt logs; do not add more Etherscan endpoints.** `getTransaction` already fetches `eth_getTransactionReceipt` and discards the logs. Etherscan's `tokentx`/`tokennfttx`/`token1155tx` are themselves derived from these logs, so decoding locally is authoritative, costs zero extra calls, and eliminates the "which address do I query?" question that caused the miss.
- **`transfers` is additive; `tokenTransfers` stays.** Tron (`tronscan.provider.ts:266`) and Solana (`blockchain.service.ts:504`) populate `tokenTransfers`, and the MCP `blockchain_get_transaction` tool returns it. The new richer array is EVM-only and additive, so those paths are untouched.
- **`/blockchain/get-transaction` and `/blockchain/get-address-info` are absent from the OpenAPI contract entirely** — `api-client.ts:405-438` hand-writes their response types. Since this plan changes both shapes, that gap is closed here rather than widened (Task 5). Flagged per `CLAUDE.md`: this is the real fix, not a patch.

**Risk concentrates in Tasks 3 and 9** (tagged `opus`): Task 3 rewires the live provider without breaking Tron/Solana; Task 9 handles endpoint node creation when a leg switch points the edge at addresses that have no node yet.

**Ordering:** execute **after** `docs/plans/2026-09-02-investigations-always-have-a-trace.md` is committed. That plan is applied in the working tree and touches `api-client.ts`, `TransactionForm.tsx`, and `WalletForm.tsx`.

---

> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (`/execute`) to implement this plan task-by-task.
>
> **Do not commit.** Per root `CLAUDE.md`, every task ends by leaving its changes in the working tree and running `git status`. Do not pass `git add`/`git commit` instructions to any implementer subagent.

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/blockchain/log-decoder.ts` | Create | Every ERC-20/721/1155 transfer in a transaction becomes visible, decoded from the receipt |
| 2 | `backend/src/modules/blockchain/log-decoder.spec.ts` | Create | Locks the decoder against the real reported transaction |
| 3 | `backend/src/modules/blockchain/contract-classifier.ts` | Create | Contracts are identified as ERC-20/721/1155, and unknown tokens get symbol + decimals |
| 4 | `backend/src/modules/blockchain/contract-classifier.spec.ts` | Create | Locks probe order, revert handling, and caching |
| 5 | `backend/src/modules/blockchain/types.ts` | Modify | `DecodedTransfer` / `TokenStandard` types; `transfers` on detail, `tokenStandard` on address info |
| 6 | `backend/src/modules/blockchain/etherscan.provider.ts` | Modify | **Transactions report what actually happened** — replaces the broken `tokentx` lookup |
| 7 | `backend/src/modules/blockchain/etherscan.provider.spec.ts` | Create | First direct test coverage for this provider |
| 8 | `backend/src/modules/blockchain/blockchain.service.ts` | Modify | Surfaces `transfers` and `tokenStandard` through the API |
| 9 | `backend/src/modules/blockchain/blockchain.service.spec.ts` | Modify | Guards that Tron/Solana paths still work unchanged |
| 10 | `contracts/schemas/blockchain.yaml` | Modify | Two live endpoints stop being undocumented |
| 11 | `contracts/paths/blockchain.yaml` | Modify | Same |
| 12 | `contracts/openapi.yaml` | Modify | Registers the two paths |
| 13 | `frontend/src/types/investigation.ts` | Modify | Edges carry all transfer legs; nodes carry a token standard |
| 14 | `frontend/src/lib/api-client.ts` | Modify | Hand-written response types replaced by generated ones |
| 15 | `frontend/src/utils/selectPrimaryTransfer.ts` | Create | Deterministic default leg |
| 16 | `frontend/src/utils/selectPrimaryTransfer.test.ts` | Create | Locks the heuristic |
| 17 | `frontend/src/components/Graph/QuickAddInput.tsx` | Modify | **Paste a tx hash, get the real transfer** instead of a 0-value envelope |
| 18 | `frontend/src/components/Graph/details/TransferPicker.tsx` | Create | **User sees every transfer in the tx and picks which one the edge shows** |
| 19 | `frontend/src/components/Graph/details/TransferPicker.test.tsx` | Create | Locks picker rendering and selection |
| 20 | `frontend/src/components/Graph/details/TransactionDetails.tsx` | Modify | Hosts the picker |
| 21 | `frontend/src/components/Graph/DetailsPanel.tsx` | Modify | Routes the leg switch up to where nodes can be created |
| 22 | `frontend/src/components/Graph/SelectionDetailsPanel.tsx` | Modify | The layer `page.tsx` actually renders; carries the handler down to `DetailsPanel` |
| 23 | `frontend/src/hooks/useWalletTransactionAuthoring.ts` | Modify | Switching legs creates any missing endpoint nodes |
| 24 | `frontend/src/hooks/useWalletTransactionAuthoring.test.ts` | Modify | Locks node creation on switch |
| 25 | `frontend/src/app/cases/[caseId]/(workspace)/investigations/page.tsx` | Modify | Wires the handler through and feeds `updateTransaction` to the hook |
| 26 | `frontend/src/utils/normalizeInvestigation.ts` | Modify | New fields survive a reload |
| 27 | `frontend/src/hooks/cytoscapeSync.ts` | Modify | Token contracts render distinctly; removes the dead `'exchange'` cast |
| 28 | `frontend/src/hooks/cytoscapeStyle.ts` | Modify | Same |
| 29 | `frontend/src/components/Graph/details/WalletDetails.tsx` | Modify | Shows the token standard badge |

### What changes (UX and DX)

**For the user (UX):**
- Pasting a contract-call tx hash produces the transfer that actually moved value, not a 0-value envelope between a relayer and a router.
- NFT transfers (ERC-721/1155) are supported for the first time — they were previously undetectable.
- The details panel lists every transfer in the transaction; one click switches which one the edge represents, creating any endpoint nodes the new leg needs.
- Token contracts show their real symbol and decimals even when not in the built-in list — native USDC on Polygon (`0x3c499c54…`) is currently missed.
- Contract nodes are distinguishable from token contracts in the graph.

**For the developer (DX):**
- Two live endpoints stop being invisible to the contract; their response types become generated instead of hand-maintained in `api-client.ts`.
- `EtherscanProvider` gets its first direct test coverage.
- The dead `'exchange'` `addressType` branch — which only compiles via `as string` and would render `undefined` in `WalletDetails` — is removed.

---

## Task 1: Receipt log decoder

**Implementer:** sonnet
**Files:** Create `backend/src/modules/blockchain/log-decoder.ts`, `backend/src/modules/blockchain/log-decoder.spec.ts`

Pure functions, no I/O. All four event topic hashes below were derived with keccak-256 and cross-checked against a live Polygon receipt — use them verbatim.

**Step 1: Write the failing test.** Create `backend/src/modules/blockchain/log-decoder.spec.ts`:

```ts
import { decodeTransferLogs, RawLog } from './log-decoder';

/**
 * Logs from Polygon tx 0xb7a0ee5870a518ecf9784e447d536c3c4f17a4e7cc853d3d5c38f46e7cbcc1ef,
 * verbatim from eth_getTransactionReceipt. This transaction is the reason the decoder
 * exists: `account/tokentx` keyed on tx.from returns zero rows for it, because the
 * sender (a relayer) is not a party to any of its transfers.
 */
const REAL_LOGS: RawLog[] = [
  {
    // Approval — must be ignored, it is not a transfer
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x0',
  },
  {
    // ERC-20 Transfer: 25 USDC
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x1',
  },
  {
    // ERC-20 Transfer: the onward hop
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
      '0x00000000000000000000000066dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x2',
  },
  {
    // ERC-20 Transfer with value 0 — a refund leg, decoded but never primary
    address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x000000000000000000000000776023a4573bd972c4c3e2a76f611d3c2bef516e',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
    ],
    data: '0x0000000000000000000000000000000000000000000000000000000000000000',
    logIndex: '0x3',
  },
  {
    // ERC-721 Transfer (mint): same topic0 as ERC-20, but FOUR topics and empty data.
    // That shape difference is the only on-chain discriminator between the standards.
    address: '0x251be3a17af4892035c37ebf5890f4a4d889dcad',
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      '0x000000000000000000000000c55fcca7133d58a934c0431fa14383b45b6c014e',
      '0x09e1862ca89d9a29a049971a30e1878ff782fbcaea19478fe94bfeb1d2bca582',
    ],
    data: '0x',
    logIndex: '0x5',
  },
  {
    // Unrelated application event — must be ignored
    address: '0x776023a4573bd972c4c3e2a76f611d3c2bef516e',
    topics: [
      '0x0538ab32a957d2b55d0ec70a4029e73fdf19f500832839b1d7bafcfbca2a5630',
      '0x00000000000000000000000066dbff2ce099d19b4e8c5dc8b254ec7aeaf5e642',
      '0x0000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c3359',
    ],
    data: '0x00000000000000000000000000000000000000000000000000000000017d7840',
    logIndex: '0x4',
  },
];

describe('decodeTransferLogs', () => {
  it('decodes every transfer in the reported transaction and ignores non-transfer logs', () => {
    const out = decodeTransferLogs(REAL_LOGS);
    expect(out).toHaveLength(4);
    expect(out.map((t) => t.standard)).toEqual(['erc20', 'erc20', 'erc20', 'erc721']);
  });

  it('decodes an ERC-20 transfer with checksum-free lowercased endpoints and raw value', () => {
    const [first] = decodeTransferLogs(REAL_LOGS);
    expect(first).toEqual({
      standard: 'erc20',
      contractAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      from: '0xc55fcca7133d58a934c0431fa14383b45b6c014e',
      to: '0x776023a4573bd972c4c3e2a76f611d3c2bef516e',
      value: '25000000',
      logIndex: 1,
    });
  });

  it('decodes an ERC-721 transfer by topic count, carrying tokenId and a unit value', () => {
    const nft = decodeTransferLogs(REAL_LOGS).find((t) => t.standard === 'erc721');
    expect(nft).toEqual({
      standard: 'erc721',
      contractAddress: '0x251be3a17af4892035c37ebf5890f4a4d889dcad',
      from: '0x0000000000000000000000000000000000000000',
      to: '0xc55fcca7133d58a934c0431fa14383b45b6c014e',
      value: '1',
      tokenId:
        '4469282264829956043634515469381478210621183059247356743393779657588816520578',
      logIndex: 5,
    });
  });

  it('retains zero-value transfers — filtering them is the caller\'s decision', () => {
    const zero = decodeTransferLogs(REAL_LOGS).filter((t) => t.value === '0');
    expect(zero).toHaveLength(1);
    expect(zero[0].logIndex).toBe(3);
  });

  it('decodes an ERC-1155 TransferSingle', () => {
    const out = decodeTransferLogs([
      {
        address: '0xabc0000000000000000000000000000000000001',
        topics: [
          '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
          '0x000000000000000000000000000000000000000000000000000000000000dead',
          '0x0000000000000000000000001111111111111111111111111111111111111111',
          '0x0000000000000000000000002222222222222222222222222222222222222222',
        ],
        data:
          '0x0000000000000000000000000000000000000000000000000000000000000007' +
          '0000000000000000000000000000000000000000000000000000000000000003',
        logIndex: '0xa',
      },
    ]);
    expect(out).toEqual([
      {
        standard: 'erc1155',
        contractAddress: '0xabc0000000000000000000000000000000000001',
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '3',
        tokenId: '7',
        logIndex: 10,
      },
    ]);
  });

  it('decodes an ERC-1155 TransferBatch into one entry per id/value pair', () => {
    const out = decodeTransferLogs([
      {
        address: '0xabc0000000000000000000000000000000000001',
        topics: [
          '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
          '0x000000000000000000000000000000000000000000000000000000000000dead',
          '0x0000000000000000000000001111111111111111111111111111111111111111',
          '0x0000000000000000000000002222222222222222222222222222222222222222',
        ],
        // offset(ids)=0x40, offset(values)=0xa0, ids=[1,2], values=[10,20]
        data:
          '0x0000000000000000000000000000000000000000000000000000000000000040' +
          '00000000000000000000000000000000000000000000000000000000000000a0' +
          '0000000000000000000000000000000000000000000000000000000000000002' +
          '0000000000000000000000000000000000000000000000000000000000000001' +
          '0000000000000000000000000000000000000000000000000000000000000002' +
          '0000000000000000000000000000000000000000000000000000000000000002' +
          '000000000000000000000000000000000000000000000000000000000000000a' +
          '0000000000000000000000000000000000000000000000000000000000000014',
        logIndex: '0xb',
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((t) => [t.tokenId, t.value])).toEqual([
      ['1', '10'],
      ['2', '20'],
    ]);
  });

  it('returns an empty array for an empty or malformed log set rather than throwing', () => {
    expect(decodeTransferLogs([])).toEqual([]);
    expect(
      decodeTransferLogs([
        { address: '0xa', topics: [], data: '0x', logIndex: '0x0' },
        {
          address: '0xb',
          topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
          data: '0x',
          logIndex: '0x1',
        },
      ]),
    ).toEqual([]);
  });
});
```

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix backend -- log-decoder
```
Expect: `Cannot find module './log-decoder'`.

**Step 3: Minimal implementation.** Create `backend/src/modules/blockchain/log-decoder.ts`:

```ts
import { DecodedTransfer, TokenStandard } from './types';

/**
 * Decodes token transfers out of a transaction receipt's logs.
 *
 * This exists because Etherscan's `account/tokentx` family cannot answer the
 * question we actually have. It is ERC-20 only (NFT transfers live at
 * `tokennfttx`/`token1155tx`), and it is keyed by ADDRESS — so answering "what
 * moved in this transaction?" requires already knowing a party to the transfer.
 * For a relayed contract call the sender is party to nothing, and the query
 * returns zero rows while the transaction plainly moved value.
 *
 * The receipt logs have neither limitation. They are also what Etherscan derives
 * those endpoints from, so decoding locally is strictly more authoritative and
 * costs no extra network call — `getTransaction` already fetches the receipt.
 */

/** `Transfer(address,address,uint256)` — shared by ERC-20 and ERC-721. */
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** `TransferSingle(address,address,address,uint256,uint256)` */
const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
/** `TransferBatch(address,address,address,uint256[],uint256[])` */
const TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  logIndex?: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Right-most 20 bytes of a 32-byte topic, lowercased. */
function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

/** Splits `0x`-prefixed ABI data into 32-byte words as hex strings. */
function words(data: string): string[] {
  const body = data.startsWith('0x') ? data.slice(2) : data;
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

function toDecimal(word: string): string {
  return BigInt(`0x${word}`).toString();
}

/**
 * Decodes `(uint256[] ids, uint256[] values)` from TransferBatch data. The head
 * holds two byte-offsets into the same buffer; each points at a length word
 * followed by that many value words.
 */
function decodeBatchArrays(data: string): { ids: string[]; values: string[] } {
  const w = words(data);
  if (w.length < 2) return { ids: [], values: [] };

  const readArray = (headWord: string): string[] => {
    const wordIndex = Number(BigInt(`0x${headWord}`) / 32n);
    const lengthWord = w[wordIndex];
    if (lengthWord === undefined) return [];
    const length = Number(BigInt(`0x${lengthWord}`));
    const items: string[] = [];
    for (let i = 0; i < length; i++) {
      const item = w[wordIndex + 1 + i];
      if (item === undefined) return items;
      items.push(toDecimal(item));
    }
    return items;
  };

  return { ids: readArray(w[0]), values: readArray(w[1]) };
}

/**
 * Returns every token transfer in `logs`, in log order.
 *
 * Zero-value transfers are RETAINED. They are real on-chain events (approvals
 * settling, refund legs) and dropping them here would hide them from the details
 * panel; choosing which leg to feature is the caller's job.
 */
export function decodeTransferLogs(logs: RawLog[]): DecodedTransfer[] {
  const out: DecodedTransfer[] = [];

  logs.forEach((log, position) => {
    const topic0 = log.topics?.[0]?.toLowerCase();
    if (!topic0) return;

    const logIndex = log.logIndex ? Number(BigInt(log.logIndex)) : position;
    const contractAddress = log.address.toLowerCase();
    const base = { contractAddress, logIndex };

    if (topic0 === TRANSFER) {
      // The ERC-20 / ERC-721 discriminator is arity, not signature: ERC-721
      // indexes tokenId as a fourth topic and leaves data empty, whereas ERC-20
      // leaves value unindexed in data.
      if (log.topics.length === 4) {
        out.push({
          ...base,
          standard: 'erc721' as TokenStandard,
          from: topicToAddress(log.topics[1]),
          to: topicToAddress(log.topics[2]),
          value: '1',
          tokenId: toDecimal(log.topics[3].replace(/^0x/, '')),
        });
        return;
      }
      if (log.topics.length === 3) {
        const [valueWord] = words(log.data);
        if (valueWord === undefined) return;
        out.push({
          ...base,
          standard: 'erc20' as TokenStandard,
          from: topicToAddress(log.topics[1]),
          to: topicToAddress(log.topics[2]),
          value: toDecimal(valueWord),
        });
      }
      return;
    }

    if (topic0 === TRANSFER_SINGLE && log.topics.length === 4) {
      const [idWord, valueWord] = words(log.data);
      if (idWord === undefined || valueWord === undefined) return;
      out.push({
        ...base,
        standard: 'erc1155' as TokenStandard,
        from: topicToAddress(log.topics[2]),
        to: topicToAddress(log.topics[3]),
        value: toDecimal(valueWord),
        tokenId: toDecimal(idWord),
      });
      return;
    }

    if (topic0 === TRANSFER_BATCH && log.topics.length === 4) {
      const { ids, values } = decodeBatchArrays(log.data);
      const from = topicToAddress(log.topics[2]);
      const to = topicToAddress(log.topics[3]);
      ids.forEach((tokenId, i) => {
        if (values[i] === undefined) return;
        out.push({
          ...base,
          standard: 'erc1155' as TokenStandard,
          from,
          to,
          value: values[i],
          tokenId,
        });
      });
    }
  });

  return out;
}

/** True when a transfer mints from, or burns to, the zero address. */
export function isMintOrBurn(transfer: DecodedTransfer): boolean {
  return transfer.from === ZERO_ADDRESS || transfer.to === ZERO_ADDRESS;
}
```

Add to `backend/src/modules/blockchain/types.ts` (place directly above `RawTransactionDetail`):

```ts
export type TokenStandard = 'erc20' | 'erc721' | 'erc1155';

/** One token transfer decoded from a receipt log. Addresses are lowercased. */
export interface DecodedTransfer {
  standard: TokenStandard;
  contractAddress: string;
  from: string;
  to: string;
  /** Raw base units. Always '1' for ERC-721. */
  value: string;
  /** Present for ERC-721 and ERC-1155 only. */
  tokenId?: string;
  logIndex: number;
  /**
   * Token metadata, attached by the provider after classification (Task 3).
   * `decodeTransferLogs` never sets these — logs carry no metadata — so they are
   * absent on a freshly decoded leg and populated before the leg leaves the
   * provider. Task 4 reads them when resolving each leg's token.
   */
  symbol?: string;
  decimals?: number;
  name?: string;
}
```

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix backend -- log-decoder
```
Expect: 7 passing.

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 2: On-chain contract classifier

**Implementer:** sonnet
**Files:** Create `backend/src/modules/blockchain/contract-classifier.ts`, `backend/src/modules/blockchain/contract-classifier.spec.ts`

The probe sequence and every selector below were verified live against the three contracts in the reported transaction:

| Contract | `supportsInterface(721)` | `supportsInterface(1155)` | `decimals()` | `symbol()` | Result |
|---|---|---|---|---|---|
| `0x3c499c54…` USDC | revert | revert | `6` | `USDC` | `erc20` |
| `0x251be3a1…` | `true` | `false` | revert | `COURTYARD` | `erc721` |
| `0x07d79f0f…` | `false` | `false` | revert | revert | contract, no standard |

Note USDC **reverts** on `supportsInterface` (it predates ERC-165) while the router **returns false**. Both must be treated as "not this standard" — a revert is an expected answer here, not an error.

**Step 1: Write the failing test.** Create `backend/src/modules/blockchain/contract-classifier.spec.ts`:

```ts
import { ContractClassifier, EthCall } from './contract-classifier';

const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const NFT = '0x251be3a17af4892035c37ebf5890f4a4d889dcad';
const ROUTER = '0x07d79f0f6879f4d555431573320236628d16083e';
const EOA = '0x51c0d73faec63d6471e434a483e0874f6cb17203';

const TRUE_WORD = '0x0000000000000000000000000000000000000000000000000000000000000001';
const FALSE_WORD = '0x0000000000000000000000000000000000000000000000000000000000000000';
// abi.encode("USDC") — offset 0x20, length 4, then the bytes
const USDC_SYMBOL =
  '0x0000000000000000000000000000000000000000000000000000000000000020' +
  '0000000000000000000000000000000000000000000000000000000000000004' +
  '5553444300000000000000000000000000000000000000000000000000000000';
const SIX = '0x0000000000000000000000000000000000000000000000000000000000000006';

/** Builds an EthCall stub that dispatches on (address, 4-byte selector). */
function stubCall(table: Record<string, Record<string, string | Error>>): EthCall {
  return jest.fn(async (address: string, data: string) => {
    const selector = data.slice(0, 10);
    const answer = table[address.toLowerCase()]?.[selector];
    if (answer === undefined) throw new Error('execution reverted');
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

const IS_721 = '0x01ffc9a780ac58cd'.slice(0, 10);

describe('ContractClassifier', () => {
  it('classifies a contract that answers supportsInterface(0x80ac58cd) as erc721', async () => {
    const call = stubCall({
      [NFT]: {
        '0x01ffc9a7': TRUE_WORD,
        '0x95d89b41':
          '0x0000000000000000000000000000000000000000000000000000000000000020' +
          '0000000000000000000000000000000000000000000000000000000000000009' +
          '434f555254594152440000000000000000000000000000000000000000000000',
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', NFT);
    expect(out.addressType).toBe('contract');
    expect(out.tokenStandard).toBe('erc721');
    expect(out.symbol).toBe('COURTYARD');
  });

  it('classifies a reverting-supportsInterface token with decimals() as erc20', async () => {
    const call = stubCall({
      [USDC]: { '0x313ce567': SIX, '0x95d89b41': USDC_SYMBOL },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', USDC);
    expect(out).toMatchObject({
      addressType: 'contract',
      tokenStandard: 'erc20',
      decimals: 6,
      symbol: 'USDC',
    });
  });

  it('classifies a contract that returns false everywhere as a plain contract', async () => {
    const call = stubCall({
      [ROUTER]: { '0x01ffc9a7': FALSE_WORD },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', ROUTER);
    expect(out.addressType).toBe('contract');
    expect(out.tokenStandard).toBeUndefined();
    expect(out.symbol).toBeUndefined();
  });

  it('classifies an address with no code as a wallet without probing', async () => {
    const call = stubCall({});
    const c = new ContractClassifier(async () => '0x', call);
    const out = await c.classify('polygon', EOA);
    expect(out).toEqual({ addressType: 'wallet' });
    expect(call).not.toHaveBeenCalled();
  });

  it('caches by chain and address so a second classify makes no further calls', async () => {
    const getCode = jest.fn(async () => '0x60806040');
    const call = stubCall({ [USDC]: { '0x313ce567': SIX, '0x95d89b41': USDC_SYMBOL } });
    const c = new ContractClassifier(getCode, call);
    await c.classify('polygon', USDC);
    const callsAfterFirst = (call as jest.Mock).mock.calls.length;
    await c.classify('polygon', USDC.toUpperCase());
    expect(getCode).toHaveBeenCalledTimes(1);
    expect((call as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
  });

  it('decodes a bytes32 symbol from tokens that predate the string ABI', async () => {
    const call = stubCall({
      [USDC]: {
        '0x313ce567': SIX,
        // "MKR" packed into a bare bytes32, no offset/length header
        '0x95d89b41':
          '0x4d4b520000000000000000000000000000000000000000000000000000000000',
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    expect((await c.classify('polygon', USDC)).symbol).toBe('MKR');
  });

  it('returns a plain contract rather than throwing when every probe fails', async () => {
    const call: EthCall = jest.fn(async () => {
      throw new Error('network down');
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    await expect(c.classify('polygon', ROUTER)).resolves.toEqual({ addressType: 'contract' });
  });
});
```

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix backend -- contract-classifier
```
Expect: `Cannot find module './contract-classifier'`.

**Step 3: Minimal implementation.** Create `backend/src/modules/blockchain/contract-classifier.ts`:

```ts
import { TokenStandard } from './types';

/**
 * Identifies what a contract IS, from the chain rather than from a list.
 *
 * `token-resolver.ts` can only answer for addresses somebody hard-coded, which
 * is why native USDC on Polygon (0x3c499c54…) resolves to nothing today while
 * the bridged USDC.e sitting next to it in the table resolves fine. Receipt-log
 * decoding makes that gap load-bearing: logs carry no symbol or decimals, so
 * without an on-chain probe every non-listed token renders as raw base units.
 *
 * Probe order matters. ERC-20 has no ERC-165 interface id, so it can only be
 * identified by successfully calling `decimals()` — which means the ERC-165
 * questions must be asked first, or an ERC-721 with a `decimals()` extension
 * would be misfiled. A REVERT is a legitimate negative answer, not a failure:
 * USDC reverts on `supportsInterface` because it predates ERC-165 entirely.
 *
 * Bytecode is immutable, so a classification is permanently valid and is cached
 * for the process lifetime.
 */

const SELECTOR = {
  supportsInterface: '0x01ffc9a7',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  name: '0x06fdde03',
} as const;

const INTERFACE_ID = {
  erc721: '80ac58cd',
  erc1155: 'd9b67a26',
} as const;

export interface ContractClassification {
  addressType: 'wallet' | 'contract';
  tokenStandard?: TokenStandard;
  symbol?: string;
  decimals?: number;
  name?: string;
}

export type GetCode = (address: string) => Promise<string>;
export type EthCall = (address: string, data: string) => Promise<string>;

function supportsInterfaceCalldata(interfaceId: string): string {
  return `${SELECTOR.supportsInterface}${interfaceId}${'0'.repeat(56)}`;
}

/** Decodes an ABI string return, tolerating the bare-bytes32 form old tokens use. */
function decodeString(raw: string): string | undefined {
  const body = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (body.length === 0) return undefined;

  // Exactly one word and no dynamic header — a packed bytes32.
  if (body.length === 64) {
    const bytes = Buffer.from(body.replace(/(00)+$/, ''), 'hex').toString('utf8');
    const trimmed = bytes.replace(/\0/g, '').trim();
    return trimmed || undefined;
  }

  try {
    const length = Number(BigInt(`0x${body.slice(64, 128)}`));
    if (!Number.isFinite(length) || length === 0) return undefined;
    const chars = body.slice(128, 128 + length * 2);
    const decoded = Buffer.from(chars, 'hex').toString('utf8').replace(/\0/g, '').trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

function decodeUint(raw: string): number | undefined {
  try {
    const n = Number(BigInt(raw));
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function isTrueWord(raw: string): boolean {
  try {
    return BigInt(raw) === 1n;
  } catch {
    return false;
  }
}

export class ContractClassifier {
  private cache = new Map<string, ContractClassification>();

  constructor(
    private readonly getCode: GetCode,
    private readonly ethCall: EthCall,
  ) {}

  async classify(chain: string, address: string): Promise<ContractClassification> {
    const key = `${chain}:${address.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = await this.probe(address);
    this.cache.set(key, result);
    return result;
  }

  private async probe(address: string): Promise<ContractClassification> {
    let code: string;
    try {
      code = await this.getCode(address);
    } catch {
      // Cannot tell; do not cache a guess as fact.
      return { addressType: 'wallet' };
    }
    if (!code || code === '0x' || code === '0x0') return { addressType: 'wallet' };

    const result: ContractClassification = { addressType: 'contract' };

    // A revert here is a negative answer, so every probe is individually guarded.
    const tryCall = async (data: string): Promise<string | undefined> => {
      try {
        return await this.ethCall(address, data);
      } catch {
        return undefined;
      }
    };

    const is721 = await tryCall(supportsInterfaceCalldata(INTERFACE_ID.erc721));
    if (is721 && isTrueWord(is721)) {
      result.tokenStandard = 'erc721';
    } else {
      const is1155 = await tryCall(supportsInterfaceCalldata(INTERFACE_ID.erc1155));
      if (is1155 && isTrueWord(is1155)) {
        result.tokenStandard = 'erc1155';
      } else {
        const decimalsRaw = await tryCall(SELECTOR.decimals);
        const decimals = decimalsRaw === undefined ? undefined : decodeUint(decimalsRaw);
        if (decimals !== undefined) {
          result.tokenStandard = 'erc20';
          result.decimals = decimals;
        }
      }
    }

    if (!result.tokenStandard) return result;

    const [symbolRaw, nameRaw] = await Promise.all([
      tryCall(SELECTOR.symbol),
      tryCall(SELECTOR.name),
    ]);
    const symbol = symbolRaw === undefined ? undefined : decodeString(symbolRaw);
    const name = nameRaw === undefined ? undefined : decodeString(nameRaw);
    if (symbol) result.symbol = symbol;
    if (name) result.name = name;

    return result;
  }
}
```

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix backend -- contract-classifier
```
Expect: 7 passing.

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 3: Wire decoding and classification into EtherscanProvider

**Implementer:** opus
**Files:** Modify `backend/src/modules/blockchain/etherscan.provider.ts` (lines 144-229), `backend/src/modules/blockchain/types.ts`. Create `backend/src/modules/blockchain/etherscan.provider.spec.ts`.

This is the load-bearing task: it replaces a live code path used by every EVM chain. `tokenTransfers` must keep working, because Tron (`tronscan.provider.ts:266`) and Solana (`blockchain.service.ts:504`) populate the same field and the MCP tool reads it.

Read `backend/src/modules/blockchain/esplora-client.spec.ts` first — it is the existing precedent for `jest.spyOn(global, 'fetch')` provider tests, and `EtherscanProvider.fetchApi` calls global `fetch` the same way.

**Step 1: Write the failing test.** Create `backend/src/modules/blockchain/etherscan.provider.spec.ts`. Follow `esplora-client.spec.ts` for the `mockResponse` helper. Cover:

1. `getTransaction` on a receipt containing the four REAL_LOGS transfers returns `transfers` with 4 entries in log order, standards `['erc20','erc20','erc20','erc721']`.
2. `getTransaction` **never calls `account/tokentx`** — assert no fetch URL contains `action=tokentx`. This is the regression guard for the original bug.
3. `tokenTransfers` is still populated, containing only the ERC-20 legs, with `tokenSymbol`/`tokenDecimal` filled from the classifier.
4. A receipt with no transfer logs yields `transfers: []` and `tokenTransfers: []`, and the native `value`/`from`/`to` are unchanged.
5. `getAddressInfo` returns `tokenStandard: 'erc20'` and `symbol: 'USDC'` for a token contract, and no `tokenStandard` for an EOA.
6. A classifier failure degrades gracefully: `transfers` is still returned, with `token` metadata absent rather than the call throwing.

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix backend -- etherscan.provider
```

**Step 3: Implementation.**

In `types.ts`, extend the two interfaces (additive only):

```ts
export interface RawTransactionDetail {
  // …existing fields unchanged…
  tokenTransfers: RawTokenTransfer[];
  /**
   * Every token transfer decoded from the receipt logs, in log order.
   * EVM only — Tron and Solana providers leave this undefined and continue to
   * populate `tokenTransfers`.
   */
  transfers?: DecodedTransfer[];
}

export interface RawAddressInfo {
  address: string;
  addressType: 'wallet' | 'contract';
  balance: string;
  label?: string;
  /** Set when the address is a token contract. */
  tokenStandard?: TokenStandard;
  symbol?: string;
  decimals?: number;
  name?: string;
}
```

In `etherscan.provider.ts`:

- Import `decodeTransferLogs` and `ContractClassifier`.
- Add a private `classifier` field, constructed once with closures over `fetchApi`:

```ts
  private readonly classifier = new ContractClassifier(
    (address) => this.fetchApi<string>('proxy', 'eth_getCode', { address, tag: 'latest' }),
    (address, data) => this.fetchApi<string>('proxy', 'eth_call', { to: address, data, tag: 'latest' }),
  );
```

  `fetchApi` already caches by `(chain, module/action, params)` and rate-limits, so probes inherit both. It throws on JSON-RPC `error` objects, which is exactly what `ContractClassifier`'s per-probe `try/catch` expects for a revert.

- In `getTransaction`, **delete the `account/tokentx` block (lines 171-191 in the current file)** and replace it with log decoding plus metadata enrichment:

```ts
    // Decode transfers from the receipt we already have. The previous
    // implementation asked `account/tokentx` for `txResult.from`, which is
    // ERC-20-only AND keyed by a party to the transfer — for a relayed call the
    // sender is party to nothing and the query returns zero rows.
    const transfers = decodeTransferLogs(receiptResult?.logs ?? []);

    // Classify each distinct token contract once, for symbol/decimals. Failures
    // degrade to an undecorated transfer rather than losing the transfer.
    const contracts = [...new Set(transfers.map((t) => t.contractAddress))];
    const metadata = new Map<string, ContractClassification>();
    await Promise.all(
      contracts.map(async (addr) => {
        try {
          metadata.set(addr, await this.classifier.classify(this.chain.id, addr));
        } catch {
          // Leave unclassified.
        }
      }),
    );

    // `tokenTransfers` remains the cross-chain field Tron and Solana populate,
    // so it keeps carrying the ERC-20 subset in its original shape.
    const tokenTransfers: RawTokenTransfer[] = transfers
      .filter((t) => t.standard === 'erc20')
      .map((t) => {
        const meta = metadata.get(t.contractAddress);
        return {
          hash: txResult.hash,
          from: t.from,
          to: t.to,
          value: t.value,
          tokenName: meta?.name ?? '',
          tokenSymbol: meta?.symbol ?? '',
          tokenDecimal: meta?.decimals !== undefined ? String(meta.decimals) : '18',
          contractAddress: t.contractAddress,
          timeStamp: timestamp,
          blockNumber: String(blockNumber),
          gas: txResult.gas ? BigInt(txResult.gas).toString() : '0',
          gasPrice: txResult.gasPrice ? BigInt(txResult.gasPrice).toString() : '0',
          gasUsed: receiptResult?.gasUsed ? BigInt(receiptResult.gasUsed).toString() : '0',
          nonce: txResult.nonce ? BigInt(txResult.nonce).toString() : '0',
        };
      });
```

  Then enrich each decoded leg with its contract's metadata, and return both arrays:

```ts
    // `decodeTransferLogs` cannot know symbol/decimals — logs carry neither — so
    // the metadata is grafted on here, after classification. A leg whose contract
    // failed to classify keeps its raw value and simply has no metadata.
    const enrichedTransfers: DecodedTransfer[] = transfers.map((t) => {
      const meta = metadata.get(t.contractAddress);
      return {
        ...t,
        ...(meta?.symbol ? { symbol: meta.symbol } : {}),
        ...(meta?.decimals !== undefined ? { decimals: meta.decimals } : {}),
        ...(meta?.name ? { name: meta.name } : {}),
      };
    });
```

  and in the returned object, alongside the existing fields:

```ts
      tokenTransfers,
      transfers: enrichedTransfers,
```

- In `getAddressInfo`, replace the inline `eth_getCode` classification with the classifier so both call sites share one probe path and one cache:

```ts
  async getAddressInfo(address: string): Promise<RawAddressInfo> {
    const [classification, balanceHex] = await Promise.all([
      this.classifier.classify(this.chain.id, address),
      this.fetchApi<string>('proxy', 'eth_getBalance', { address, tag: 'latest' }),
    ]);
    return {
      address,
      addressType: classification.addressType,
      balance: balanceHex ? BigInt(balanceHex).toString() : '0',
      ...(classification.tokenStandard ? { tokenStandard: classification.tokenStandard } : {}),
      ...(classification.symbol ? { symbol: classification.symbol } : {}),
      ...(classification.decimals !== undefined ? { decimals: classification.decimals } : {}),
      ...(classification.name ? { name: classification.name } : {}),
    };
  }
```

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix backend -- etherscan.provider && npm test --prefix backend -- blockchain.service
```
Both suites must pass — `blockchain.service.spec.ts` is the guard that Tron and Solana are unaffected.

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 4: Surface transfers and tokenStandard through the service

**Implementer:** sonnet
**Files:** Modify `backend/src/modules/blockchain/blockchain.service.ts` (interfaces at 19-75, `getTransaction` at 268-350, `getAddressInfo` at 379-412), `backend/src/modules/blockchain/blockchain.service.spec.ts`

**Step 1: Write the failing test.** Add a new `describe('generic provider path — getTransaction/getAddressInfo')` block to `blockchain.service.spec.ts`, using the existing `stubBlockchainProvider` helper.

Note there is **no pre-existing coverage** for this path: the spec's only `describe` blocks are `'bitcoin path'`, `'solana path'`, `'ethereum regression'` (which exercises `fetchHistory` only), and `'address/chain shape guard'`. This task adds the first tests for the generic EVM/Tron `getTransaction`/`getAddressInfo` route, so all three cases below are new:

1. `getTransaction` on an EVM chain passes `detail.transfers` through to `result.transfers`, with `token` metadata resolved per leg via `tokenResolver`.
2. A provider returning no `transfers` (the Tron shape) yields `transfers: []` while `tokenTransfers` is passed through unchanged — this is the guard that Tron and Solana are unaffected by the new field.
3. `getAddressInfo` passes `tokenStandard` through when the provider supplies it, and omits it otherwise.

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix backend -- blockchain.service
```

**Step 3: Implementation.** Extend `TransactionDetailResult`:

```ts
export interface TransferLegResult {
  standard: TokenStandard;
  from: string;
  to: string;
  amount: string;
  token: { address: string; symbol: string; decimals: number };
  tokenId?: string;
  logIndex: number;
}

export interface TransactionDetailResult {
  // …existing fields unchanged, including tokenTransfers…
  /** Every decoded transfer leg. Empty on chains without log decoding. */
  transfers: TransferLegResult[];
}
```

and `AddressInfoResult`:

```ts
export interface AddressInfoResult {
  address: string;
  addressType: 'wallet' | 'contract';
  balance: string;
  label?: string;
  tokenStandard?: TokenStandard;
  symbol?: string;
  decimals?: number;
  name?: string;
}
```

In the EVM branch of `getTransaction`, map `detail.transfers ?? []` into `transfers`, resolving each leg's token through `this.tokenResolver.resolveFromTransfer(chain, t.contractAddress, t.symbol ?? '', t.decimals ?? 0)`. Set `transfers: []` in the bitcoin branch (line 302 area) and the Solana branch so the field is always present. Pass the four new optional fields straight through in `getAddressInfo`.

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix backend -- blockchain
```

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 5: Document the two undocumented endpoints in the contract

**Implementer:** sonnet
**Files:** Modify `contracts/schemas/blockchain.yaml`, `contracts/paths/blockchain.yaml`, `contracts/openapi.yaml`

`/blockchain/get-transaction` and `/blockchain/get-address-info` are live in `blockchain.controller.ts` but appear nowhere in `contracts/`, which is why `api-client.ts:405-438` hand-writes their response types. This task closes that gap; Task 6 then deletes the hand-written types.

**Step 1 & 2 (contract-only task, no unit test):** verification is the generator plus the type-checked frontend in Task 6.

**Step 3: Implementation.** In `contracts/schemas/blockchain.yaml` add: `GetTransactionRequest` (`txHash`, `chain`, both required strings), `GetAddressInfoRequest` (`address`, `chain`), `TokenStandard` (`type: string`, `enum: [erc20, erc721, erc1155]`), `TransferLeg` (`standard` → `$ref TokenStandard`, `from`, `to`, `amount`, `token` → the same inline object shape used by `TransactionResult`, `tokenId` optional, `logIndex` integer), `TransactionDetailResult` (mirroring the service interface exactly, including `tokenTransfers`, the new required `transfers` array, `isError`, and optional `utxo`/`solana` refs), and `AddressInfoResult` (`address`, `addressType` enum `[wallet, contract]`, `balance` required; `label`, `tokenStandard`, `symbol`, `decimals`, `name` optional).

In `contracts/paths/blockchain.yaml` add both POST operations with `operationId: getTransaction` and `getAddressInfo`, referencing the request/response schemas and the shared `ErrorResponse`. Register both paths in `contracts/openapi.yaml` next to the existing `/blockchain/fetch-history` entry (lines 76-77).

**Step 4: Verify.**
```bash
npm run gen && npm run build:be
```
Expect `getTransaction` and `getAddressInfo` to appear in `operations` in both generated `api-types.ts` files.

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 6: Frontend types and api-client

**Implementer:** sonnet
**Files:** Modify `frontend/src/types/investigation.ts` (`WalletNode` 97-116, `TransactionEdge` 118-149), `frontend/src/lib/api-client.ts` (405-438), `frontend/src/utils/normalizeInvestigation.ts`

**Step 1: Write the failing test.** Add to `frontend/src/utils/normalizeInvestigation.test.ts` (create if absent, `/** @jest-environment jsdom */` pragma not needed for a pure util): a node with `tokenStandard: 'erc20'` and an edge with `transfers` + `selectedTransferIndex` survive normalization; an edge without them normalizes to `undefined` for both rather than throwing.

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix frontend -- normalizeInvestigation
```

**Step 3: Implementation.** Add to `WalletNode`:

```ts
  /** Set when the address is a token contract. Distinct from `addressType`,
   *  which records only whether the address has code. */
  tokenStandard?: 'erc20' | 'erc721' | 'erc1155';
```

Add to `TransactionEdge`:

```ts
  tokenStandard?: 'erc20' | 'erc721' | 'erc1155';
  tokenId?: string;
  /**
   * Every transfer decoded from this transaction's receipt. The edge itself
   * always mirrors ONE of them (see `selectedTransferIndex`) — switching the
   * selection rewrites `from`/`to`/`amount`/`token` so that every existing
   * consumer keeps reading the same fields it always has.
   *
   * `from`/`to` here are ADDRESSES; the edge's own `from`/`to` are NODE IDS.
   */
  transfers?: TransferLeg[];
  /** Index into `transfers` that this edge currently represents. */
  selectedTransferIndex?: number;
```

and the leg type next to it:

```ts
export interface TransferLeg {
  standard: 'erc20' | 'erc721' | 'erc1155';
  from: string;
  to: string;
  amount: string;
  token: { address: string; symbol: string; decimals: number };
  tokenId?: string;
  logIndex: number;
}
```

In `api-client.ts`, replace both hand-written inline response types with the generated ones now available:

```ts
  getTransaction: (txHash: string, chain: string) =>
    request<components['schemas']['TransactionDetailResult']>('/blockchain/get-transaction', {
      method: 'POST',
      body: JSON.stringify({ txHash, chain }),
    }),

  getAddressInfo: (address: string, chain: string) =>
    request<components['schemas']['AddressInfoResult']>('/blockchain/get-address-info', {
      method: 'POST',
      body: JSON.stringify({ address, chain }),
    }),
```

In `normalizeInvestigation.ts`, carry `tokenStandard` on nodes and `transfers`/`selectedTransferIndex`/`tokenStandard`/`tokenId` on edges through normalization alongside the existing `addressType` default at line 36.

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix frontend -- normalizeInvestigation && npm run build:fe
```

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 7: Primary transfer selection

**Implementer:** sonnet
**Files:** Create `frontend/src/utils/selectPrimaryTransfer.ts`, `frontend/src/utils/selectPrimaryTransfer.test.ts`

**Step 1: Write the failing test.** Create `frontend/src/utils/selectPrimaryTransfer.test.ts` with legs mirroring the reported transaction (three USDC legs, one of them zero-value, plus the ERC-721 mint), asserting:

1. Zero-value legs are never selected — with legs `[zero, nonZero]` the result is index 1.
2. A leg the transaction sender is party to wins over an earlier leg it is not party to.
3. With no sender-party leg (the reported tx — the relayer is party to nothing), the first non-zero leg by log index wins: the 25 USDC payment at `logIndex` 1.
4. An all-zero-value leg set returns index 0 rather than `-1`, so the caller always has something to show.
5. An empty array returns `-1`.

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix frontend -- selectPrimaryTransfer
```

**Step 3: Minimal implementation.** Create `frontend/src/utils/selectPrimaryTransfer.ts`:

```ts
import type { TransferLeg } from '@/types/investigation';

/**
 * Chooses which decoded transfer an edge should represent by default.
 *
 * Deterministic on purpose. The graph is an exhibit, so "why is this the edge
 * shown?" needs an answer that does not depend on a heuristic score: drop the
 * legs that moved nothing, prefer a leg the transaction's sender was actually
 * party to, otherwise take the earliest remaining by log order.
 *
 * Returns an index into `transfers`, or -1 when there are none.
 */
export function selectPrimaryTransfer(transfers: TransferLeg[], txSender?: string): number {
  if (transfers.length === 0) return -1;

  const nonZero = transfers
    .map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => leg.amount !== '0');

  // Every leg moved zero: still show one rather than nothing.
  if (nonZero.length === 0) return 0;

  if (txSender) {
    const sender = txSender.toLowerCase();
    const partyToSender = nonZero.find(
      ({ leg }) => leg.from.toLowerCase() === sender || leg.to.toLowerCase() === sender,
    );
    if (partyToSender) return partyToSender.index;
  }

  return nonZero.reduce((best, current) =>
    current.leg.logIndex < best.leg.logIndex ? current : best,
  ).index;
}
```

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix frontend -- selectPrimaryTransfer
```

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 8: QuickAddInput builds the prefill from decoded transfers

**Implementer:** sonnet
**Files:** Modify `frontend/src/components/Graph/QuickAddInput.tsx` (lines 122-155)

**Step 1: Write the failing test.** Create `frontend/src/components/Graph/QuickAddInput.test.tsx` with the `/** @jest-environment jsdom */` pragma, mocking `@/lib/api-client`. Assert that pasting the reported tx hash with a mocked `getTransaction` returning the four legs calls `onResolveTransaction` with `from`/`to`/`amount` from the 25 USDC leg (not the native 0-value envelope), `transfers` carrying all four legs, `selectedTransferIndex: 1`, and `tokenStandard: 'erc20'`. Add a second case where `transfers` is empty, asserting the existing `tokenTransfers`-then-native fallback still applies.

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix frontend -- QuickAddInput
```

**Step 3: Implementation.** Replace the `primaryTransfer` block (lines 129-133) with:

```ts
        // Decoded receipt legs are authoritative when present. `tokenTransfers`
        // remains the fallback for chains without log decoding (Tron, Solana),
        // and the native tx is the last resort.
        const legs = detail.transfers ?? [];
        const primaryIndex = selectPrimaryTransfer(legs, detail.from);
        const primary = primaryIndex >= 0 ? legs[primaryIndex] : undefined;
        const legacy = detail.tokenTransfers[0];

        const token = primary?.token || legacy?.token || detail.token;
        const amount = primary?.amount || legacy?.amount || detail.amount;
        const from = primary?.from || legacy?.from || detail.from;
        const to = primary?.to || legacy?.to || detail.to;
```

Extend the prefill object with `transfers: legs.length ? legs : undefined`, `selectedTransferIndex: primaryIndex >= 0 ? primaryIndex : undefined`, `tokenStandard: primary?.standard`, and `tokenId: primary?.tokenId`. Import `selectPrimaryTransfer` from `@/utils/selectPrimaryTransfer`.

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix frontend -- QuickAddInput
```

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 9: Transfer picker in the details panel

**Implementer:** opus
**Files:** Create `frontend/src/components/Graph/details/TransferPicker.tsx`, `frontend/src/components/Graph/details/TransferPicker.test.tsx`. Modify `frontend/src/components/Graph/details/TransactionDetails.tsx`, `frontend/src/components/Graph/DetailsPanel.tsx`, `frontend/src/components/Graph/SelectionDetailsPanel.tsx`, `frontend/src/hooks/useWalletTransactionAuthoring.ts`, `frontend/src/hooks/useWalletTransactionAuthoring.test.ts`, `frontend/src/app/cases/[caseId]/(workspace)/investigations/page.tsx`

**Prop chain — all four layers must be threaded.** `page.tsx:370` renders `SelectionDetailsPanel`, which at `SelectionDetailsPanel.tsx:98` renders `DetailsPanel`, which renders `TransactionDetails`. Skipping the `SelectionDetailsPanel` layer leaves the handler unreachable. Follow the existing `updateTransaction` → `onUpdateTransaction` threading at `SelectionDetailsPanel.tsx:22,45,105` as the template.

This is the second load-bearing task. Selecting a different leg changes the edge's endpoints, and the new endpoints are frequently addresses with **no node in the graph** — in the reported transaction the USDC legs run between `0xc55fcca7…`, `0x776023a4…` and `0x66dbff2c…`, none of which is the pasted sender. So the handler cannot be a plain `onUpdate`; it must run where `findOrCreateWallet` lives.

Note the id/address distinction that this codebase already documents at `useWalletTransactionAuthoring.ts:113-127`: `TransferLeg.from`/`to` are **addresses**, while `TransactionEdge.from`/`to` are **node ids**. Leaving a raw address in an edge endpoint produces an edge pointing at no node, which Cytoscape silently drops while the edge still persists and still counts in exports and aggregation.

**Step 1: Write the failing tests.**

`TransferPicker.test.tsx` (jsdom pragma): renders one row per leg with symbol, amount and truncated endpoints; marks the row at `selectedTransferIndex` as active; a zero-value leg renders with its zero amount and is still selectable; clicking a non-active row calls `onSelect` with that leg's index; an ERC-721 leg renders its token id rather than an amount; the component renders nothing when `transfers` is undefined or has fewer than two entries (a single-leg transaction has no choice to offer).

In `useWalletTransactionAuthoring.test.ts`, add a `describe('handleSelectTransfer')` covering:
1. Selecting a leg whose endpoints already exist rewrites the edge's `from`/`to` to those **node ids**, plus `amount`, `token`, `tokenStandard`, `tokenId`, and `selectedTransferIndex` — and creates no new nodes.
2. Selecting a leg whose endpoints do not exist creates a wallet node per missing address in the edge's own trace, and the edge's `from`/`to` are the new node ids, never the raw addresses.
3. `crossTrace` is recomputed from the resolved endpoints' traces.
4. Selecting the already-selected index is a no-op.

**Step 2: Run them, confirm they fail.**
```bash
npm test --prefix frontend -- TransferPicker useWalletTransactionAuthoring
```

**Step 3: Implementation.**

`TransferPicker.tsx` — presentational only, props `{ transfers: TransferLeg[]; selectedIndex?: number; onSelect: (index: number) => void }`. Render a labelled section ("Transfers in this transaction") with a button per leg; match the existing styling vocabulary in `TransactionDetails.tsx` (`text-xs font-semibold text-canvas-muted uppercase` for the label, `bg-canvas-fill border border-canvas-line rounded-lg` for rows, `bg-brand text-white` for the active row). Show standard as a small badge (`ERC-20` / `ERC-721` / `ERC-1155`), then amount + symbol (or `#<tokenId>` for ERC-721), then `from → to` truncated. Return `null` when `transfers` is undefined or `transfers.length < 2`. No emojis; use `react-icons/fa6` if an icon is wanted.

`TransactionDetails.tsx` — render `<TransferPicker>` directly below the From→To block, wired to a new optional prop `onSelectTransfer?: (index: number) => void`.

`DetailsPanel.tsx` — thread `onSelectTransfer` from a new prop down to `TransactionDetails`, resolving the trace id the same way the existing `onUpdate` closure for transactions does at lines 137 and 198 (searching `traces` for the edge containing the tx id).

`SelectionDetailsPanel.tsx` — add `selectTransfer` to `SelectionDetailsPanelProps` (beside `updateTransaction` at line 22), destructure it (line 45), and pass it to `<DetailsPanel>` as `onSelectTransfer` (beside `onUpdateTransaction={updateTransaction}` at line 105).

`useWalletTransactionAuthoring.ts` — add:

```ts
  /**
   * Repoints an edge at a different leg of its own transaction.
   *
   * The edge's displayed fields are REWRITTEN rather than derived, because every
   * consumer — exports, aggregation, cytoscape, the agent's view of the graph —
   * already reads `from`/`to`/`amount`/`token`. `transfers` is retained so the
   * choice stays reversible.
   *
   * A leg's endpoints are ADDRESSES and may name nodes that do not exist yet: the
   * legs of a relayed call routinely run between contracts the user never pasted.
   * Each endpoint therefore goes through `findOrCreateWallet`, which returns the
   * existing node id on a case-insensitive address match and mints one otherwise.
   * Storing the raw address instead would produce an edge pointing at no node,
   * which Cytoscape silently drops while the edge still persists in the trace.
   */
  const handleSelectTransfer = useCallback(
    (traceId: string, transaction: TransactionEdge, index: number) => {
      const leg = transaction.transfers?.[index];
      if (!leg || transaction.selectedTransferIndex === index) return;

      const fromId = findOrCreateWallet(leg.from, transaction.chain, traceId);
      const toId = findOrCreateWallet(leg.to, transaction.chain, traceId);

      const fromTrace = allWallets.find((w) => w.wallet.id === fromId)?.traceId ?? traceId;
      const toTrace = allWallets.find((w) => w.wallet.id === toId)?.traceId ?? traceId;

      updateTransaction(traceId, transaction.id, {
        from: fromId,
        to: toId,
        amount: leg.amount,
        token: leg.token,
        tokenStandard: leg.standard,
        tokenId: leg.tokenId,
        selectedTransferIndex: index,
        crossTrace: fromTrace !== toTrace,
      });
    },
    [allWallets, findOrCreateWallet, updateTransaction],
  );
```

  Add `updateTransaction` to `UseWalletTransactionAuthoringArgs` **and** to the destructuring in the hook body, and return `handleSelectTransfer` from the hook. Note `findOrCreateWallet` calls `addWallet` synchronously, so `allWallets` will not yet contain a just-created node in this render — the `?? traceId` fallback covers that, since a node created here always lands in `traceId`.

`page.tsx` — two changes, both required:
1. **Pass `updateTransaction` into the hook's argument object at its call site.** The hook currently receives `addWallet`, `updateWallet` and `addTransaction`; `updateTransaction` is already destructured from `useInvestigation` in this file (it is passed to `SelectionDetailsPanel`), so add it to the `useWalletTransactionAuthoring({ … })` call. Adding it only to the interface leaves it `undefined` at runtime.
2. Pull `handleSelectTransfer` from the hook and pass it to `SelectionDetailsPanel` as `selectTransfer`, gated on `canMutate` in the same style as the neighbouring handlers (`canMutate ? handleSelectTransfer : () => {}`).

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix frontend -- TransferPicker useWalletTransactionAuthoring && npm run build:fe
```

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Task 10: Token standard in the graph, and remove the dead `'exchange'` branch

**Implementer:** sonnet
**Files:** Modify `frontend/src/hooks/cytoscapeSync.ts` (line 130), `frontend/src/hooks/cytoscapeStyle.ts` (lines 57-70), `frontend/src/components/Graph/details/WalletDetails.tsx` (constants at lines 7-17, `addrType` at line 71), `frontend/src/hooks/cytoscapeSync.test.ts`

`'exchange'` as an `addressType` exists in exactly two places — the `(node.addressType as string) === 'exchange'` cast at `cytoscapeSync.ts:130` and the `node[addressType = "exchange"]` selector at `cytoscapeStyle.ts:65`. It is not in the `WalletNode.addressType` union, no backend response produces it, no form sets it, and `WalletDetails`' `ADDRESS_TYPE_LABELS`/`ADDRESS_TYPE_COLORS` have no entry for it — if it ever appeared it would render `undefined` as the badge text. It is dead code that only compiles via a type assertion. `'exchange'` already has a real, wired home as an `EntityCategory` in the labeled-entities system (`frontend/src/lib/labeled-entities.ts`), which `WalletDetails` already renders a badge for.

**Step 1: Write the failing test.** Add to `cytoscapeSync.test.ts` using the existing `wallet(id, overrides)` fixture builder and `makeFakeCy`:

1. A node with `addressType: 'contract'` and `tokenStandard: 'erc20'` syncs `nodeShape: 'hexagon'` and `tokenStandard: 'erc20'` in its cytoscape data.
2. A node with `addressType: 'contract'` and no `tokenStandard` still syncs `nodeShape: 'roundrectangle'`.
3. An explicit `node.shape` still overrides both.
4. A plain wallet syncs `nodeShape: 'ellipse'` and no `tokenStandard`.

**Step 2: Run it, confirm it fails.**
```bash
npm test --prefix frontend -- cytoscapeSync
```

**Step 3: Implementation.** In `cytoscapeSync.ts`, replace line 130:

```ts
        // Token contracts read differently from plain contracts at a glance.
        // The former `'exchange'` branch here was unreachable — nothing has ever
        // produced that addressType, and it only compiled via a cast. Exchange
        // attribution lives in the labeled-entities system, which WalletDetails
        // already renders.
        const addrTypeShape =
          node.tokenStandard ? 'hexagon'
          : node.addressType === 'contract' ? 'roundrectangle'
          : 'ellipse';
        const nodeShape = node.shape || addrTypeShape;
```

and add `tokenStandard: node.tokenStandard` to the node `data` object at line 133.

In `cytoscapeStyle.ts`, delete the `node[addressType = "exchange"]` rule and add a token-contract border rule beside the existing contract rule:

```ts
  {
    selector: 'node[tokenStandard]',
    style: { 'border-style': 'solid', 'border-opacity': 0.9, 'border-width': 2 },
  },
```

In `WalletDetails.tsx`, add `TOKEN_STANDARD_LABELS` (`erc20: 'ERC-20'`, `erc721: 'ERC-721'`, `erc1155: 'ERC-1155'`) and render the standard as a second badge next to the existing address-type badge when `wallet.tokenStandard` is set. Leave `ADDRESS_TYPE_LABELS`/`ADDRESS_TYPE_COLORS` otherwise untouched.

**Step 4: Run tests, confirm pass.**
```bash
npm test --prefix frontend && npm run build:fe
```

**Step 5: Report, do not commit.**
```bash
git status
```
Leave the changes in the working tree. Per root `CLAUDE.md`, work is never committed unless the user asks.

---

## Final verification

```bash
npm run gen
npm run build:be && npm run build:fe
npm test --prefix backend && npm test --prefix frontend
git status
```

Then re-check the reported transaction end to end: paste
`0xb7a0ee5870a518ecf9784e447d536c3c4f17a4e7cc853d3d5c38f46e7cbcc1ef` on Polygon and confirm the edge is 25 USDC from `0xc55fcca7…` to `0x776023a4…`, that the details panel lists four transfers including the ERC-721 mint, and that switching to the mint repoints the edge and creates the `0x251be3a1…` endpoint node.

## Engineering Decisions Made

- **`selectPrimaryTransfer` lives on the frontend**, not in `shared/`. The backend returns the full ordered list so the MCP tool can reason over all legs; "which one is featured" is a graph-UI default with no backend consumer.
- **`tokenTransfers` is kept alongside the new `transfers`.** Tron and Solana populate it and the MCP tool returns it; removing it would break two chains for no gain.
- **The classifier is constructed inside `EtherscanProvider`** rather than injected, mirroring how `TokenResolver` is instantiated at `blockchain.service.ts:80`. It reuses `fetchApi`, so it inherits the shared rate limiter and response cache for free.
- **Classification is cached in a plain `Map` on the classifier**, not in `ResponseCache`. `ResponseCache` caps at 200 entries and evicts by expiry; contract bytecode is immutable, so these entries should not compete with transaction responses for that budget.
- **Zero-value legs are decoded and displayed, only excluded from being *primary*.** They are real events and hiding them would misrepresent the transaction.
- **ERC-721 legs carry `value: '1'`** so amount-based consumers (aggregation, exports) do not have to special-case them; the token id is carried separately.
