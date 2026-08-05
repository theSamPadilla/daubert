/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useInvestigation } from './useInvestigation';
import type {
  Investigation,
  Trace,
  WalletNode,
  TransactionEdge,
  UtxoContext,
} from '@/types/investigation';

// ── Fixture builders (adapted from cytoscapeSync.test.ts / useSelectedItem.test.ts) ──

function wallet(id: string, overrides: Partial<WalletNode> = {}): WalletNode {
  return {
    id,
    label: id,
    address: id,
    chain: 'bitcoin',
    notes: '',
    tags: [],
    position: { x: 0, y: 0 },
    parentTrace: 'trace-a',
    ...overrides,
  };
}

function edge(id: string, from: string, to: string, overrides: Partial<TransactionEdge> = {}): TransactionEdge {
  return {
    id,
    from,
    to,
    chain: 'bitcoin',
    timestamp: '1700000000',
    amount: '1000000',
    token: { address: '', symbol: 'BTC', decimals: 8 },
    notes: '',
    tags: [],
    blockNumber: 1,
    crossTrace: false,
    ...overrides,
  };
}

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

function utxo(fee: string): UtxoContext {
  return {
    inputs: [{ address: 'in-addr', value: '1000' }],
    outputs: [{ address: 'out-addr', value: '900' }],
    fee,
  } as UtxoContext;
}

describe('useInvestigation — EXTRACT_TO_TRACE / aggregateCrossEdges utxo handling', () => {
  it('drops utxo on a synthetic edge aggregated from MULTIPLE edges', () => {
    const w1 = wallet('w1'); // external, stays behind
    const w2 = wallet('w2'); // extracted (becomes the representative node)
    const w3 = wallet('w3'); // extracted
    const utxoA = utxo('100');
    const utxoB = utxo('200');
    // Both edges share the same external endpoint (w1) and token, so they
    // collapse into ONE synthetic aggregate edge inside aggregateCrossEdges.
    const e1 = edge('e1', 'w1', 'w2', { txHash: 'tx1', utxo: utxoA });
    const e2 = edge('e2', 'w1', 'w3', { txHash: 'tx2', utxo: utxoB });
    const t = trace('t1', { nodes: [w1, w2, w3], edges: [e1, e2] });

    const { result } = renderHook(() => useInvestigation(inv([t])));

    act(() => {
      result.current.extractToTrace(['w2', 'w3'], trace('extracted'));
    });

    const extracted = result.current.investigation!.traces.find((tr) => tr.id === 'extracted')!;
    expect(extracted).toBeDefined();
    expect(extracted.edges).toHaveLength(1);
    const synthetic = extracted.edges[0];
    expect(synthetic.txHash).toBe('aggregated');
    expect(synthetic.utxo).toBeUndefined();

    // Original edges must never be mutated — same utxo object reference as before.
    expect(e1.utxo).toBe(utxoA);
    expect(e2.utxo).toBe(utxoB);
  });

  it('keeps utxo on a single-edge pass-through aggregate', () => {
    const w1 = wallet('w1'); // extracted (representative node)
    const w2 = wallet('w2'); // external, only one edge to it
    const utxoC = utxo('50');
    const e3 = edge('e3', 'w1', 'w2', { txHash: 'tx3', utxo: utxoC });
    const t = trace('t1', { nodes: [w1, w2], edges: [e3] });

    const { result } = renderHook(() => useInvestigation(inv([t])));

    act(() => {
      result.current.extractToTrace(['w1'], trace('extracted'));
    });

    const extracted = result.current.investigation!.traces.find((tr) => tr.id === 'extracted')!;
    expect(extracted.edges).toHaveLength(1);
    const synthetic = extracted.edges[0];
    // Single-edge group: not an aggregate ('aggregated' txHash only applies when isMultiple).
    expect(synthetic.txHash).toBe('tx3');
    expect(synthetic.utxo).toBe(utxoC);

    // Original edge untouched.
    expect(e3.utxo).toBe(utxoC);
  });
});
