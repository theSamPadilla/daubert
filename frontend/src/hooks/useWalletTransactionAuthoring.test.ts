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
  UtxoContext,
} from '@/types/investigation';
import type { PanelMode } from '@/types/panel';

// handleAddStagedToTrace never calls apiClient, but the module is imported by
// useWalletTransactionAuthoring.ts (handleSaveNewWallet/findOrCreateWallet use
// it) — mock it out so the test doesn't drag in the real firebase client, same
// convention as useInvestigationLoader.test.ts / useCaseSeed.test.ts.
jest.mock('@/lib/api-client', () => ({
  apiClient: { getAddressInfo: jest.fn().mockResolvedValue({ addressType: 'unknown' }) },
}));

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
  const { investigation, addWallet, updateWallet, addTransaction } = useInvestigation(initial);
  const allWallets = useMemo(() => {
    if (!investigation) return [];
    return investigation.traces.flatMap((t) => t.nodes.map((w) => ({ wallet: w, traceId: t.id })));
  }, [investigation]);
  const [panelMode, setPanelMode] = useState<PanelMode>({ type: 'none' });
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [stagedItems, setStagedItems] = useState<TransactionEdge[]>([]);

  const authoring = useWalletTransactionAuthoring({
    investigation, allWallets, panelMode, setPanelMode, setSelectedItem,
    setStagedItems, addWallet, updateWallet, addTransaction,
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
