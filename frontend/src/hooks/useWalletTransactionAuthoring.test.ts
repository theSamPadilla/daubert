/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { useInvestigation } from './useInvestigation';
import { useWalletTransactionAuthoring } from './useWalletTransactionAuthoring';
import { edgeIdentityKey } from '../generated/shared/edge-identity';
import type {
  Investigation,
  Trace,
  WalletNode,
  TransactionEdge,
  TransferLeg,
  UtxoContext,
} from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

// ── Fixture builders (adapted from useInvestigation.test.ts) ────────────────

function trace(id: string, overrides: Partial<Trace> = {}): Trace {
  return {
    id,
    name: id,
    criteria: { type: 'custom' },
    visible: true,
    nodes: [],
    edges: [],
    collapsed: false,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function inv(traces: Trace[]): Investigation {
  return {
    id: 'inv-1',
    name: 'Test',
    description: '',
    createdAt: '2024-01-01',
    traces,
    metadata: {},
  };
}

/**
 * Composes useInvestigation + useWalletTransactionAuthoring the same way
 * app/cases/[caseId]/(workspace)/investigations/page.tsx wires them, so
 * handleAddStagedToTrace can be exercised against a live, mutating
 * investigation instead of a mock.
 */
function useHarness(initial: Investigation | null) {
  const { investigation, addWallet, addTransaction, updateTransaction } =
    useInvestigation(initial);
  const allWallets = useMemo(() => {
    if (!investigation) return [];
    return investigation.traces.flatMap((t) => t.nodes.map((w) => ({ wallet: w, traceId: t.id })));
  }, [investigation]);
  const [panelMode, setPanelMode] = useState<PanelMode>({ type: 'none' });
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [stagedItems, setStagedItems] = useState<TransactionEdge[]>([]);

  const authoring = useWalletTransactionAuthoring({
    investigation, allWallets, panelMode, setPanelMode, setSelectedItem,
    setStagedItems, addWallet, addTransaction, updateTransaction,
  });

  return { investigation, stagedItems, selectedItem, ...authoring };
}

// ── BTC junction fixtures (mirrors backend/.../traces.service.spec.ts's
// junctionUtxo/junctionTx: 3 inputs (index 0 coinbase) / 3 outputs (vout 1
// OP_RETURN) → 2 input legs + 2 output legs) ─────────────────────────────────

const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0';
const IN_1 = '1Input1AddressXXXXXXXXXXXXXXXX';
const IN_2 = '1Input2AddressXXXXXXXXXXXXXXXX';
const OUT_1 = 'bc1qoutput1recipientaddressxxxxxxxx';
// Whitespace-padded + mixed case, to prove the persisted node address is
// trimmed but NOT lowercased (bitcoin is case-sensitive).
const CHANGE_RAW = '  1ChangeAddressMixedCaseXyZ  ';
const CHANGE_TRIMMED = '1ChangeAddressMixedCaseXyZ';

function makeJunctionContext() {
  return {
    inputs: [
      { address: null, value: '625000000', prevTxid: '0'.repeat(64), prevVout: 4294967295, coinbase: true },
      { address: IN_1, value: '100000', prevTxid: 'aa'.repeat(32), prevVout: 0 },
      { address: IN_2, value: '200000', prevTxid: 'bb'.repeat(32), prevVout: 1 },
    ],
    outputs: [
      { address: OUT_1, value: '150000', index: 0 },
      { address: null, value: '0', index: 1, opReturn: true },
      { address: CHANGE_RAW, value: '140000', index: 2, change: true, changeEvidence: ['reused input address'] },
    ],
    fee: '10000',
    warnings: ['consolidation'],
    confirmed: true,
    blockHeight: 800000,
  };
}

/** One staged row for one payable output of the junction tx. `sharedContext`
 * defaults to a fresh context per call, but callers building multiple rows for
 * the SAME transaction pass the same object so `inputs`/`outputs` are shared
 * by reference — exactly how the fetch path emits sibling rows. */
function junctionRow(
  id: string,
  vout: number,
  to: string,
  amount: string,
  sharedContext: ReturnType<typeof makeJunctionContext> = makeJunctionContext(),
): TransactionEdge {
  return {
    id,
    from: '',
    to,
    txHash: TXID,
    chain: 'bitcoin',
    timestamp: '2024-06-01T00:00:00.000Z',
    amount,
    token: { address: '', symbol: 'BTC', decimals: 8 },
    notes: '',
    tags: [],
    blockNumber: 800000,
    crossTrace: false,
    utxo: { ...sharedContext, vout, junction: true } as UtxoContext,
  };
}

describe('handleAddStagedToTrace — Bitcoin junction rows', () => {
  it('collapses 2 staged rows of the same tx onto exactly 1 junction node + 4 legs, with correct identities', () => {
    const ctx = makeJunctionContext();
    const row1 = junctionRow('row-1', 0, OUT_1, '150000', ctx);
    const row2 = junctionRow('row-2', 2, CHANGE_RAW, '140000', ctx);

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row1, row2]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;

    // 1 junction + 2 input addresses + 2 output addresses (coinbase input and
    // OP_RETURN output produce no node) = 5 nodes total.
    expect(t1.nodes).toHaveLength(5);
    const junctions = t1.nodes.filter((n) => n.kind === 'txJunction');
    expect(junctions).toHaveLength(1);
    const jNode = junctions[0];
    expect(jNode.address).toBe(TXID);
    expect(jNode.label).toBe('3 in / 3 out');
    expect(jNode.chain).toBe('bitcoin');
    expect(jNode.explorerUrl).toBe(`https://mempool.space/tx/${TXID}`);
    expect(jNode.addressType).toBe('unknown');
    expect(jNode.parentTrace).toBe('trace-1');

    // The ledger record lives once, on the junction node, stripped of the
    // per-row fields (vout/legType/legIndex/junction).
    expect(jNode.utxoTx).not.toHaveProperty('vout');
    expect(jNode.utxoTx).not.toHaveProperty('junction');
    expect(jNode.utxoTx).not.toHaveProperty('legType');
    expect(jNode.utxoTx).not.toHaveProperty('legIndex');
    expect(jNode.utxoTx!.inputs).toHaveLength(3);
    expect(jNode.utxoTx!.outputs).toHaveLength(3);
    // Copied, not aliased to the staged row's arrays.
    expect(jNode.utxoTx!.inputs).not.toBe(ctx.inputs);
    expect(jNode.utxoTx!.outputs).not.toBe(ctx.outputs);

    // Exactly 4 leg edges: 2 input (coinbase skipped) + 2 output (OP_RETURN skipped).
    expect(t1.edges).toHaveLength(4);

    const inputLegs = t1.edges.filter((e) => e.utxo?.legType === 'input');
    expect(inputLegs).toHaveLength(2);
    expect(inputLegs.every((e) => e.to === jNode.id)).toBe(true);
    expect(inputLegs.map((e) => e.utxo!.legIndex).sort()).toEqual([1, 2]);
    expect(inputLegs.map((e) => e.amount).sort()).toEqual(['100000', '200000']);

    const outputLegs = t1.edges.filter((e) => e.utxo?.legType === 'output');
    expect(outputLegs).toHaveLength(2);
    expect(outputLegs.every((e) => e.from === jNode.id)).toBe(true);
    expect(outputLegs.map((e) => e.utxo!.vout).sort()).toEqual([0, 2]);

    // Every leg carries the structured BTC token.
    t1.edges.forEach((e) => expect(e.token).toEqual({ address: '', symbol: 'BTC', decimals: 8 }));

    // Leg edge identity: input legs key on txid:in:<original index>, output
    // legs key on txid:<vout> — the same pattern the backend import path uses.
    const addrById = new Map(t1.nodes.map((n) => [n.id, n.address]));
    const keys = t1.edges.map((e) => edgeIdentityKey(e, addrById.get(e.from) ?? e.from, addrById.get(e.to) ?? e.to));
    expect(keys.sort()).toEqual(
      [`${TXID}:in:1`, `${TXID}:in:2`, `${TXID}:0`, `${TXID}:2`].sort(),
    );

    // Leg endpoint addresses: trimmed but case-preserved (bitcoin).
    const changeNode = t1.nodes.find((n) => n.address === CHANGE_TRIMMED);
    expect(changeNode).toBeDefined();
    expect(t1.nodes.some((n) => n.address === CHANGE_RAW)).toBe(false);

    // Both staged rows are cleared regardless of dedup.
    expect(result.current.stagedItems).toHaveLength(0);
  });

  it('re-adding the same junction rows a second time adds nothing new', () => {
    const ctx = makeJunctionContext();
    const row1 = junctionRow('row-1', 0, OUT_1, '150000', ctx);
    const row2 = junctionRow('row-2', 2, CHANGE_RAW, '140000', ctx);

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row1, row2]);
    });
    act(() => {
      // Same content, fresh ids/objects — mirrors a re-fetch of the same tx.
      const ctx2 = makeJunctionContext();
      result.current.handleAddStagedToTrace('trace-1', [
        junctionRow('row-3', 0, OUT_1, '150000', ctx2),
        junctionRow('row-4', 2, CHANGE_RAW, '140000', ctx2),
      ]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(5);
    expect(t1.edges).toHaveLength(4);
  });
});

describe('handleAddStagedToTrace — direct (non-junction) BTC row', () => {
  it('adds one edge carrying the full utxo, with case-preserved endpoint addresses', () => {
    const FROM_RAW = ' 1FromAddressMixedCaseAbC ';
    const FROM_TRIMMED = '1FromAddressMixedCaseAbC';
    const TO = 'bc1qtorecipientaddressxxxx';
    const utxo = {
      inputs: [{ address: FROM_RAW, value: '160000', prevTxid: 'aa'.repeat(32), prevVout: 0 }],
      outputs: [{ address: TO, value: '150000', index: 0 }],
      fee: '10000',
      confirmed: true,
      vout: 0,
    } as UtxoContext;
    const row: TransactionEdge = {
      id: 'row-1',
      from: FROM_RAW,
      to: TO,
      txHash: TXID,
      chain: 'bitcoin',
      timestamp: '2024-06-01T00:00:00.000Z',
      amount: '150000',
      token: { address: '', symbol: 'BTC', decimals: 8 },
      notes: '',
      tags: [],
      blockNumber: 800000,
      crossTrace: false,
      utxo,
    };

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(2);
    const fromNode = t1.nodes.find((n) => n.address === FROM_TRIMMED);
    const toNode = t1.nodes.find((n) => n.address === TO);
    expect(fromNode).toBeDefined();
    expect(toNode).toBeDefined();
    // Not lowercased — bitcoin addresses are case-sensitive.
    expect(t1.nodes.some((n) => n.address === FROM_RAW.toLowerCase())).toBe(false);

    expect(t1.edges).toHaveLength(1);
    const edge = t1.edges[0];
    expect(edge.from).toBe(fromNode!.id);
    expect(edge.to).toBe(toNode!.id);
    // Deep-equal but NOT the same reference: the persisted edge gets a
    // defensive copy (including a fresh inputs/outputs array) so it can
    // never alias the staged row's utxo — which may be shared by reference
    // with sibling rows of the same fetch.
    expect(edge.utxo).toEqual(utxo);
    expect(edge.utxo).not.toBe(utxo);
    expect(edge.utxo!.inputs).not.toBe(utxo.inputs);
    expect(edge.utxo!.outputs).not.toBe(utxo.outputs);
    expect(edge.token).toEqual({ address: '', symbol: 'BTC', decimals: 8 });
  });
});

describe('handleAddStagedToTrace — EVM regression', () => {
  it('keeps the pre-existing lowercase-everywhere behavior for EVM rows', () => {
    const FROM = '0xAAAAaaaaAAAAaAAAAAAAAAAAAAaaAaAaAaAAAAAA';
    const TO = '0xBBBBbbbbBBBBbBBBBBBBBBBBBBbbBbBbBbBBBBBB';
    const row: TransactionEdge = {
      id: 'row-1',
      from: FROM,
      to: TO,
      txHash: '0xdeadbeef',
      chain: 'ethereum',
      timestamp: '2024-06-01T00:00:00.000Z',
      amount: '1000000000000000000',
      token: { address: '0xToken', symbol: 'USDC', decimals: 6 },
      notes: '',
      tags: [],
      blockNumber: 100,
      crossTrace: false,
    };

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(2);
    expect(t1.nodes.map((n) => n.address).sort()).toEqual([FROM.toLowerCase(), TO.toLowerCase()].sort());

    expect(t1.edges).toHaveLength(1);
    const edge = t1.edges[0];
    expect(edge.from).toBe(t1.nodes.find((n) => n.address === FROM.toLowerCase())!.id);
    expect(edge.to).toBe(t1.nodes.find((n) => n.address === TO.toLowerCase())!.id);
    expect(edge.utxo).toBeUndefined();
    expect(edge.token).toEqual({ address: '0xToken', symbol: 'USDC', decimals: 6 });
  });
});

describe('handleSaveNewWallet — manual BTC entry', () => {
  it('persists a manually-entered base58 BTC address case-intact (not lowercased)', () => {
    const RAW = ' 1CaseSensitiveBTCAddressXyZ ';
    const TRIMMED = '1CaseSensitiveBTCAddressXyZ';

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleSaveNewWallet('trace-1', { address: RAW, chain: 'bitcoin' });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(1);
    expect(t1.nodes[0].address).toBe(TRIMMED);
    expect(t1.nodes.some((n) => n.address === RAW.toLowerCase())).toBe(false);
  });
});

describe('findOrCreateWallet — manual BTC entry via transaction endpoints', () => {
  it('persists a base58 BTC address case-intact when created through handleSaveNewTransaction', () => {
    const FROM_RAW = '1FromBTCAddressCaseSensitiveAB';
    const TO_RAW = '3ToBTCAddressCaseSensitiveCD';

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleSaveNewTransaction('trace-1', {
        from: FROM_RAW,
        to: TO_RAW,
        chain: 'bitcoin',
      });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes.map((n) => n.address).sort()).toEqual([FROM_RAW, TO_RAW].sort());
  });
});

describe('handleAddStagedToTrace — empty-address guard', () => {
  it('never mints a wallet node for an empty BTC endpoint', () => {
    const TO = 'bc1qsomeaddressxxxxxxxxxxxxx';
    // A bare, non-junction BTC row with an empty `from` — defensive case; in
    // practice the real fetch path routes junction rows (which are the ones
    // that legitimately carry an empty endpoint) through the dedicated path
    // tested above, so this row should never occur, but must not crash or
    // mint a garbage node either.
    const row: TransactionEdge = {
      id: 'row-1',
      from: '',
      to: TO,
      txHash: TXID,
      chain: 'bitcoin',
      timestamp: '2024-06-01T00:00:00.000Z',
      amount: '150000',
      token: { address: '', symbol: 'BTC', decimals: 8 },
      notes: '',
      tags: [],
      blockNumber: 800000,
      crossTrace: false,
    };

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(1);
    expect(t1.nodes[0].address).toBe(TO);
    expect(t1.nodes.some((n) => n.address === '')).toBe(false);
  });
});

describe('handleAddStagedToTrace — Solana rows (no junction concept)', () => {
  const FEE_PAYER = 'FeePayerSoLanaAddressXXXXXXXXXXXXXXXXXXXXX';
  const FROM = 'FromSolanaAddressXXXXXXXXXXXXXXXXXXXXXXXXX';
  const TO = 'ToSolanaAddressXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const SIG = 'SolSignatureXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

  function solanaRow(
    id: string,
    transferIndex: number,
    overrides: Partial<TransactionEdge> = {},
  ): TransactionEdge {
    return {
      id,
      from: FROM,
      to: TO,
      txHash: SIG,
      chain: 'solana',
      timestamp: '2024-06-01T00:00:00.000Z',
      amount: '1000000000',
      token: { address: '', symbol: 'SOL', decimals: 9 },
      notes: '',
      tags: [],
      blockNumber: 0,
      crossTrace: false,
      solana: { transferIndex, feePayer: FEE_PAYER, kind: 'native' },
      ...overrides,
    };
  }

  it('authors a direct edge (never a junction node) carrying the full solana context', () => {
    const row = solanaRow('row-1', 0);
    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(2);
    expect(t1.nodes.some((n) => n.kind === 'txJunction')).toBe(false);
    expect(t1.edges).toHaveLength(1);
    expect(t1.edges[0].solana).toEqual(row.solana);
  });

  it('two rows of the same signature with distinct transferIndex produce distinct edges', () => {
    const row1 = solanaRow('row-1', 0);
    const row2 = solanaRow('row-2', 1, {
      solana: { transferIndex: 1, feePayer: FEE_PAYER, kind: 'native' },
    });

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row1, row2]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.edges).toHaveLength(2);
    expect(t1.edges.map((e) => e.solana?.transferIndex).sort()).toEqual([0, 1]);
  });

  it('skips a row with an empty `to` — never authors a half-edge or a node for it', () => {
    const row = solanaRow('row-1', 0, { to: '' });
    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleAddStagedToTrace('trace-1', [row]);
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(0);
    expect(t1.edges).toHaveLength(0);
  });
});

describe('handleSaveNewWallet — manual Tron entry', () => {
  it('persists a manually-entered Tron address case-intact (not lowercased)', () => {
    const RAW = ' TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t ';
    const TRIMMED = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleSaveNewWallet('trace-1', { address: RAW, chain: 'tron' });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(1);
    expect(t1.nodes[0].address).toBe(TRIMMED);
    expect(t1.nodes.some((n) => n.address === TRIMMED.toLowerCase())).toBe(false);
  });
});

describe('findOrCreateWallet — manual Tron entry via transaction endpoints', () => {
  it('persists Tron addresses case-intact when created through handleSaveNewTransaction', () => {
    const FROM_RAW = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const TO_RAW = 'TGzgVdQszcAHbEd9VELwifASLRdQY9kTcx';

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleSaveNewTransaction('trace-1', {
        from: FROM_RAW,
        to: TO_RAW,
        chain: 'tron',
      });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes.map((n) => n.address).sort()).toEqual([FROM_RAW, TO_RAW].sort());
  });
});

describe('handleSaveNewTransaction — endpoint resolves to a node id', () => {
  it('reuses an existing node when the endpoint is typed in a different case (no duplicate, no dangling edge)', () => {
    const CANON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    const TYPED = CANON.toLowerCase();
    const existing: WalletNode = {
      id: 'tron-node-1',
      label: 'Existing',
      address: CANON,
      chain: 'tron',
      notes: '',
      tags: [],
      position: { x: 0, y: 0 },
      parentTrace: 'trace-1',
    };

    const { result } = renderHook(() =>
      useHarness(inv([trace('trace-1', { nodes: [existing] })])),
    );
    act(() => {
      result.current.handleSaveNewTransaction('trace-1', {
        from: TYPED,
        to: 'TGzgVdQszcAHbEd9VELwifASLRdQY9kTcx',
        chain: 'tron',
      });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    // No duplicate node for the differently-cased spelling.
    expect(t1.nodes.filter((n) => n.address === CANON)).toHaveLength(1);
    // And the edge references the node ID, not the raw address string.
    const edge = t1.edges[0];
    expect(edge.from).toBe('tron-node-1');
    // Every endpoint resolves to a real node — no dangling references.
    const ids = new Set(t1.nodes.map((n) => n.id));
    expect(ids.has(edge.from)).toBe(true);
    expect(ids.has(edge.to)).toBe(true);
  });

  it('still accepts an endpoint given as a wallet id (regression)', () => {
    const a: WalletNode = {
      id: 'node-a', label: 'A', address: '0xaaa', chain: 'ethereum',
      notes: '', tags: [], position: { x: 0, y: 0 }, parentTrace: 'trace-1',
    };
    const b: WalletNode = {
      id: 'node-b', label: 'B', address: '0xbbb', chain: 'ethereum',
      notes: '', tags: [], position: { x: 0, y: 0 }, parentTrace: 'trace-1',
    };

    const { result } = renderHook(() =>
      useHarness(inv([trace('trace-1', { nodes: [a, b] })])),
    );
    act(() => {
      result.current.handleSaveNewTransaction('trace-1', {
        from: 'node-a', to: 'node-b', chain: 'ethereum',
      });
    });

    const t1 = result.current.investigation!.traces.find((t) => t.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(2); // no spurious node minted from the ids
    expect(t1.edges[0].from).toBe('node-a');
    expect(t1.edges[0].to).toBe('node-b');
  });
});

// ── handleSelectTransfer ────────────────────────────────────────────────────
// A relayed transaction's legs run between addresses the investigator never
// pasted, so switching legs is not a plain field update: the new endpoints
// routinely have no node in the graph yet.

const LEG_A = '0xc55fcca7a7c2d4b6a2c9c4f5e6d7a8b9c0d1e2f3';
const LEG_B = '0x776023a4f2e1d0c9b8a7968574635241302f1e0d';
const LEG_C = '0x66dbff2c1a0b9e8d7c6b5a4938271605f4e3d2c1';
const USDC = { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 };
const WETH = { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18 };

function transferLeg(overrides: Partial<TransferLeg> = {}): TransferLeg {
  return {
    standard: 'erc20',
    from: LEG_A,
    to: LEG_B,
    amount: '1500000',
    token: USDC,
    logIndex: 0,
    ...overrides,
  };
}

function node(id: string, address: string, parentTrace: string): WalletNode {
  return {
    id, label: id, address, chain: 'ethereum',
    notes: '', tags: [], position: { x: 0, y: 0 }, parentTrace,
  };
}

function multiLegEdge(overrides: Partial<TransactionEdge> = {}): TransactionEdge {
  return {
    id: 'edge-1',
    from: 'node-a',
    to: 'node-b',
    txHash: '0xrelayed',
    chain: 'ethereum',
    timestamp: '2024-06-01T00:00:00.000Z',
    amount: '1500000',
    token: USDC,
    tokenStandard: 'erc20',
    notes: '',
    tags: [],
    blockNumber: 100,
    crossTrace: false,
    selectedTransferIndex: 0,
    ...overrides,
  };
}

describe('handleSelectTransfer', () => {
  it('repoints the edge at existing nodes, rewriting the displayed fields and minting nothing', () => {
    const edge = multiLegEdge({
      transfers: [
        transferLeg({ logIndex: 0 }),
        transferLeg({ from: LEG_B, to: LEG_C, amount: '2500000', token: WETH, logIndex: 1 }),
      ],
    });
    const t = trace('trace-1', {
      nodes: [
        node('node-a', LEG_A, 'trace-1'),
        node('node-b', LEG_B, 'trace-1'),
        node('node-c', LEG_C, 'trace-1'),
      ],
      edges: [edge],
    });

    const { result } = renderHook(() => useHarness(inv([t])));
    act(() => {
      result.current.handleSelectTransfer('trace-1', edge, 1);
    });

    const t1 = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(3); // no new nodes

    const updated = t1.edges[0];
    expect(updated.from).toBe('node-b');
    expect(updated.to).toBe('node-c');
    expect(updated.amount).toBe('2500000');
    expect(updated.token).toEqual(WETH);
    expect(updated.tokenStandard).toBe('erc20');
    expect(updated.tokenId).toBeUndefined();
    expect(updated.selectedTransferIndex).toBe(1);
    // The choice stays reversible.
    expect(updated.transfers).toHaveLength(2);
  });

  it('creates a wallet node for each missing endpoint and never leaves a raw address in from/to', () => {
    const edge = multiLegEdge({
      transfers: [
        transferLeg({ logIndex: 0 }),
        transferLeg({
          standard: 'erc721',
          from: LEG_B,
          to: LEG_C,
          amount: '1',
          tokenId: '4242',
          token: { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', symbol: 'BAYC', decimals: 0 },
          logIndex: 1,
        }),
      ],
    });
    // Only the pasted sender exists; neither leg-1 endpoint has a node.
    const t = trace('trace-1', { nodes: [node('node-a', LEG_A, 'trace-1')], edges: [edge] });

    const { result } = renderHook(() => useHarness(inv([t])));
    act(() => {
      result.current.handleSelectTransfer('trace-1', edge, 1);
    });

    const t1 = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(3);
    expect(t1.nodes.map((n) => n.address).sort()).toEqual([LEG_A, LEG_B, LEG_C].sort());

    const updated = t1.edges[0];
    const byAddress = (addr: string) => t1.nodes.find((n) => n.address === addr)!.id;
    expect(updated.from).toBe(byAddress(LEG_B));
    expect(updated.to).toBe(byAddress(LEG_C));
    // Never the raw address.
    expect(updated.from).not.toBe(LEG_B);
    expect(updated.to).not.toBe(LEG_C);
    // Every endpoint resolves to a real node — no dangling references.
    const ids = new Set(t1.nodes.map((n) => n.id));
    expect(ids.has(updated.from)).toBe(true);
    expect(ids.has(updated.to)).toBe(true);

    expect(updated.tokenStandard).toBe('erc721');
    expect(updated.tokenId).toBe('4242');
  });

  it('recomputes crossTrace from the resolved endpoints traces', () => {
    const edge = multiLegEdge({
      transfers: [
        transferLeg({ from: LEG_A, to: LEG_B, logIndex: 0 }),
        transferLeg({ from: LEG_A, to: LEG_C, amount: '2500000', logIndex: 1 }),
      ],
    });
    const t1 = trace('trace-1', {
      nodes: [node('node-a', LEG_A, 'trace-1'), node('node-b', LEG_B, 'trace-1')],
      edges: [edge],
    });
    const t2 = trace('trace-2', { nodes: [node('node-c', LEG_C, 'trace-2')] });

    const { result } = renderHook(() => useHarness(inv([t1, t2])));

    // Leg 1 lands on a node living in a sibling trace.
    act(() => {
      result.current.handleSelectTransfer('trace-1', edge, 1);
    });
    let updated = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!.edges[0];
    expect(updated.to).toBe('node-c');
    expect(updated.crossTrace).toBe(true);

    // Switching back to a same-trace leg clears it again.
    act(() => {
      result.current.handleSelectTransfer('trace-1', updated, 0);
    });
    updated = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!.edges[0];
    expect(updated.to).toBe('node-b');
    expect(updated.crossTrace).toBe(false);
  });

  it('is a no-op when the already-selected index is picked again', () => {
    const edge = multiLegEdge({
      amount: 'UNTOUCHED',
      selectedTransferIndex: 1,
      from: 'node-a',
      to: 'node-a',
      transfers: [
        transferLeg({ logIndex: 0 }),
        transferLeg({ from: LEG_B, to: LEG_C, amount: '2500000', logIndex: 1 }),
      ],
    });
    const t = trace('trace-1', { nodes: [node('node-a', LEG_A, 'trace-1')], edges: [edge] });

    const { result } = renderHook(() => useHarness(inv([t])));
    act(() => {
      result.current.handleSelectTransfer('trace-1', edge, 1);
    });

    const t1 = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!;
    expect(t1.nodes).toHaveLength(1); // no endpoints minted
    expect(t1.edges[0].amount).toBe('UNTOUCHED');
    expect(t1.edges[0].from).toBe('node-a');
    expect(t1.edges[0].to).toBe('node-a');
  });

  it('resolves `to` against the just-minted `from` node for a self-transfer leg, minting exactly one node', () => {
    const SELF = '0x9999999999999999999999999999999999999e';
    const edge = multiLegEdge({
      transfers: [
        transferLeg({ logIndex: 0 }),
        transferLeg({ from: SELF, to: SELF, amount: '999', logIndex: 1 }),
      ],
    });
    // Neither leg-1 endpoint (both are SELF) has a node yet.
    const t = trace('trace-1', { nodes: [node('node-a', LEG_A, 'trace-1')], edges: [edge] });

    const { result } = renderHook(() => useHarness(inv([t])));
    act(() => {
      result.current.handleSelectTransfer('trace-1', edge, 1);
    });

    const t1 = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!;
    // node-a (pre-existing) + exactly one new node for SELF — not two.
    expect(t1.nodes).toHaveLength(2);
    const selfNode = t1.nodes.find((n) => n.address === SELF);
    expect(selfNode).toBeDefined();

    const updated = t1.edges[0];
    expect(updated.from).toBe(selfNode!.id);
    expect(updated.to).toBe(selfNode!.id);
  });

  it('labels a newly-minted zero-address node "Null address" instead of a truncated address', () => {
    const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
    const edge = multiLegEdge({
      transfers: [
        transferLeg({ logIndex: 0 }),
        transferLeg({
          standard: 'erc721',
          from: ZERO_ADDRESS,
          to: LEG_C,
          amount: '1',
          tokenId: '7',
          logIndex: 1,
        }),
      ],
    });
    const t = trace('trace-1', { nodes: [node('node-a', LEG_A, 'trace-1')], edges: [edge] });

    const { result } = renderHook(() => useHarness(inv([t])));
    act(() => {
      result.current.handleSelectTransfer('trace-1', edge, 1);
    });

    const t1 = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!;
    const zeroNode = t1.nodes.find((n) => n.address === ZERO_ADDRESS);
    expect(zeroNode).toBeDefined();
    expect(zeroNode!.label).toBe('Null address');
    // The address itself is unchanged — only the label reflects the sentinel.
    expect(zeroNode!.address).toBe(ZERO_ADDRESS);
  });
});

// ── handleSaveNewTransaction — decoded transfer fields (regression) ─────────
// TransactionForm/QuickAddInput pass `transfers`/`selectedTransferIndex`/
// `tokenStandard`/`tokenId` through `data` off the prefill. These previously
// never made it onto the authored edge, so TransferPicker had nothing to
// render for a QuickAdd-authored transaction — this is the real authoring
// path, unlike the handleSelectTransfer tests above which seed `transfers`
// directly onto a fabricated edge.
describe('handleSaveNewTransaction — decoded transfer fields', () => {
  it('carries transfers, selectedTransferIndex, tokenStandard and tokenId onto the created edge', () => {
    const legs: TransferLeg[] = [
      transferLeg({ logIndex: 0 }),
      transferLeg({ from: LEG_B, to: LEG_C, amount: '1', standard: 'erc721', tokenId: '42', logIndex: 1 }),
    ];

    const { result } = renderHook(() => useHarness(inv([trace('trace-1')])));
    act(() => {
      result.current.handleSaveNewTransaction('trace-1', {
        from: LEG_A,
        to: LEG_B,
        chain: 'ethereum',
        amount: legs[0].amount,
        token: legs[0].token,
        transfers: legs,
        selectedTransferIndex: 0,
        tokenStandard: 'erc20',
      });
    });

    const t1 = result.current.investigation!.traces.find((tr) => tr.id === 'trace-1')!;
    const edge = t1.edges[0];
    expect(edge.transfers).toEqual(legs);
    expect(edge.selectedTransferIndex).toBe(0);
    expect(edge.tokenStandard).toBe('erc20');
    expect(edge.tokenId).toBeUndefined();
  });
});
