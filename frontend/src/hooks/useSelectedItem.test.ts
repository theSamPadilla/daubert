/** @jest-environment jsdom */
import { renderHook, act } from '@testing-library/react';
import { useSelectedItem } from './useSelectedItem';
import type {
  Investigation,
  Trace,
  WalletNode,
  TransactionEdge,
  Group,
  EdgeBundle,
} from '@/types/investigation';

// ── Fixture builders (adapted from cytoscapeSync.test.ts) ─────────────────────

function wallet(id: string, overrides: Partial<WalletNode> = {}): WalletNode {
  return {
    id,
    label: id,
    address: `0x${id}`,
    chain: 'eth',
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
    chain: 'eth',
    timestamp: '1700000000',
    amount: '1000000',
    token: { address: '0xtok', symbol: 'USDC', decimals: 6 },
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSelectedItem', () => {
  it('clears selection when the selected wallet is deleted', () => {
    const w = wallet('w1');
    const initialInv = inv([trace('t1', { nodes: [w] })]);
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: initialInv as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'wallet', data: w }));
    rerender({ i: inv([trace('t1', { nodes: [] })]) });
    expect(result.current.selectedItem).toBeNull();
  });

  it('re-derives the wallet snapshot when its label changes', () => {
    const w = wallet('w1', { label: 'before' });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([trace('t1', { nodes: [w] })]) as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'wallet', data: w }));
    rerender({ i: inv([trace('t1', { nodes: [{ ...w, label: 'after' }] })]) });
    expect(result.current.selectedItem?.data.label).toBe('after');
  });

  it('clears aggregatedEdge selection when all underlying edges are gone', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2');
    const t = trace('t1', { nodes: [w1, w2], edges: [e1, e2] });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([t]) as Investigation | null },
    });
    act(() =>
      result.current.setSelectedItem({
        type: 'aggregatedEdge',
        data: { traceId: 't1', edges: [e1, e2] },
      })
    );
    // Remove all edges from the trace
    rerender({ i: inv([trace('t1', { nodes: [w1, w2], edges: [] })]) });
    expect(result.current.selectedItem).toBeNull();
  });

  it('filters aggregatedEdge edges to surviving subset when some are deleted', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2');
    const t = trace('t1', { nodes: [w1, w2], edges: [e1, e2] });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([t]) as Investigation | null },
    });
    act(() =>
      result.current.setSelectedItem({
        type: 'aggregatedEdge',
        data: { traceId: 't1', edges: [e1, e2] },
      })
    );
    // Remove e2; only e1 survives
    rerender({ i: inv([trace('t1', { nodes: [w1, w2], edges: [e1] })]) });
    expect(result.current.selectedItem).not.toBeNull();
    expect(result.current.selectedItem?.data.edges).toHaveLength(1);
    expect(result.current.selectedItem?.data.edges[0].id).toBe('e1');
  });

  it('clears selection when the selected trace is deleted', () => {
    const t = trace('t1');
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([t]) as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'trace', data: t }));
    // Remove the trace entirely
    rerender({ i: inv([]) });
    expect(result.current.selectedItem).toBeNull();
  });

  it('clears selection when the selected group is deleted', () => {
    const g: Group = { id: 'g1', name: 'Group 1', traceId: 't1' };
    const t = trace('t1', { groups: [g] });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([t]) as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'group', data: g }));
    // Remove the group
    rerender({ i: inv([trace('t1', { groups: [] })]) });
    expect(result.current.selectedItem).toBeNull();
  });

  it('clears selection when the selected transaction is deleted', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const t = trace('t1', { nodes: [w1, w2], edges: [e1] });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([t]) as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'transaction', data: e1 }));
    rerender({ i: inv([trace('t1', { nodes: [w1, w2], edges: [] })]) });
    expect(result.current.selectedItem).toBeNull();
  });

  it('re-derives the transaction snapshot when its amount changes', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2', { amount: '100' });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([trace('t1', { nodes: [w1, w2], edges: [e1] })]) as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'transaction', data: e1 }));
    rerender({ i: inv([trace('t1', { nodes: [w1, w2], edges: [{ ...e1, amount: '200' }] })]) });
    expect(result.current.selectedItem?.data.amount).toBe('200');
  });

  it('clears selection when the selected edge bundle is deleted', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const bundle: EdgeBundle = {
      id: 'b1',
      traceId: 't1',
      fromNodeId: 'w1',
      toNodeId: 'w2',
      token: 'USDC',
      collapsed: true,
      edgeIds: ['e1'],
    };
    const t = trace('t1', { nodes: [w1, w2], edges: [e1], edgeBundles: [bundle] });
    const { result, rerender } = renderHook(({ i }) => useSelectedItem(i), {
      initialProps: { i: inv([t]) as Investigation | null },
    });
    act(() => result.current.setSelectedItem({ type: 'edgeBundle', data: bundle }));
    // Remove the bundle
    rerender({ i: inv([trace('t1', { nodes: [w1, w2], edges: [e1], edgeBundles: [] })]) });
    expect(result.current.selectedItem).toBeNull();
  });

  it('clearSelection sets selectedItem to null', () => {
    const { result } = renderHook(() => useSelectedItem(null));
    act(() => result.current.setSelectedItem({ type: 'wallet', data: wallet('w1') }));
    act(() => result.current.clearSelection());
    expect(result.current.selectedItem).toBeNull();
  });
});
