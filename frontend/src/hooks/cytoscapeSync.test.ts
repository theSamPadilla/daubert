import { syncCytoscape } from './cytoscapeSync';
import { makeFakeCy } from './__test-utils__/fakeCytoscape';
import type {
  Investigation,
  Trace,
  WalletNode,
  TransactionEdge,
  Group,
  EdgeBundle,
} from '../types/investigation';

// ── Fixture builders ─────────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('syncCytoscape', () => {
  it('1. empty investigation: clears all elements via cy.elements().remove()', () => {
    const cy = makeFakeCy();
    // Pre-populate with an element so we can verify removal actually fires
    cy.add({ group: 'nodes', data: { id: 'pre-existing' } });
    cy.__addCalls.length = 0; // reset so the post-sync assertion ignores setup
    (cy.add as jest.Mock).mockClear();

    syncCytoscape(cy, null);

    expect(cy.elements).toHaveBeenCalled();
    expect(cy.__elements.get('pre-existing')!.__removed).toBe(true);
    expect(cy.add).not.toHaveBeenCalled();
    expect(cy.__addCalls).toHaveLength(0);
  });

  it('2. one trace + 2 wallets + 1 edge: adds parent, both wallets, one edge with right source/target', () => {
    const w1 = wallet('w1', { position: { x: 10, y: 20 } });
    const w2 = wallet('w2', { position: { x: 30, y: 40 } });
    const e1 = edge('e1', 'w1', 'w2');
    const t = trace('trace-a', { nodes: [w1, w2], edges: [e1] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const ids = cy.__addCalls.map((c) => c.data.id);
    expect(ids).toContain('trace-a');
    expect(ids).toContain('w1');
    expect(ids).toContain('w2');
    expect(ids).toContain('e1');
    expect(cy.__addCalls).toHaveLength(4);

    const edgeCall = cy.__addCalls.find((c) => c.data.id === 'e1')!;
    expect(edgeCall.group).toBe('edges');
    expect(edgeCall.data.source).toBe('w1');
    expect(edgeCall.data.target).toBe('w2');
  });

  it('3. collapsed trace: single node added with collapsed:true, member wallets not added', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const t = trace('trace-a', { nodes: [w1, w2], collapsed: true });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    expect(cy.__addCalls).toHaveLength(1);
    const traceCall = cy.__addCalls[0];
    expect(traceCall.data.id).toBe('trace-a');
    expect(traceCall.data.collapsed).toBe(true);
    expect(traceCall.data.label).toBe('trace-a (2)');

    const ids = cy.__addCalls.map((c) => c.data.id);
    expect(ids).not.toContain('w1');
    expect(ids).not.toContain('w2');
  });

  it('4. collapsed group: leaf added with isCollapsedGroup:true, member wallets skipped', () => {
    const g: Group = { id: 'g1', name: 'Group 1', traceId: 'trace-a', collapsed: true };
    const w1 = wallet('w1', { groupId: 'g1', position: { x: 10, y: 10 } });
    const w2 = wallet('w2', { groupId: 'g1', position: { x: 20, y: 20 } });
    const w3 = wallet('w3'); // ungrouped, should still appear
    const t = trace('trace-a', { nodes: [w1, w2, w3], groups: [g] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const ids = cy.__addCalls.map((c) => c.data.id);
    expect(ids).toContain('trace-a');
    expect(ids).toContain('g1');
    expect(ids).toContain('w3');
    expect(ids).not.toContain('w1');
    expect(ids).not.toContain('w2');

    const groupCall = cy.__addCalls.find((c) => c.data.id === 'g1')!;
    expect(groupCall.data.isCollapsedGroup).toBe(true);
    expect(groupCall.data.displayLabel).toBe('Group 1 (2)');
  });

  it('5. collapsed edge bundle: bundle edge added with isBundleEdge:true, individual edges skipped', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2', { timestamp: '1700000000' });
    const e2 = edge('e2', 'w1', 'w2', { timestamp: '1700100000' });
    const bundle: EdgeBundle = {
      id: 'b1',
      traceId: 'trace-a',
      fromNodeId: 'w1',
      toNodeId: 'w2',
      token: 'USDC',
      collapsed: true,
      edgeIds: ['e1', 'e2'],
    };
    const t = trace('trace-a', { nodes: [w1, w2], edges: [e1, e2], edgeBundles: [bundle] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const ids = cy.__addCalls.map((c) => c.data.id);
    expect(ids).toContain('b1');
    expect(ids).not.toContain('e1');
    expect(ids).not.toContain('e2');

    const bundleCall = cy.__addCalls.find((c) => c.data.id === 'b1')!;
    expect(bundleCall.group).toBe('edges');
    expect(bundleCall.data.isBundleEdge).toBe(true);
    expect(bundleCall.data.source).toBe('w1');
    expect(bundleCall.data.target).toBe('w2');
  });

  it('6. reparent on re-sync: existing.move({ parent }) called when groupId changes', () => {
    const gA: Group = { id: 'gA', name: 'A', traceId: 'trace-a' };
    const gB: Group = { id: 'gB', name: 'B', traceId: 'trace-a' };
    const w1 = wallet('w1', { groupId: 'gA' });

    const t1 = trace('trace-a', { nodes: [w1], groups: [gA, gB] });
    const cy = makeFakeCy();
    syncCytoscape(cy, inv([t1]));

    // First sync should have added w1 with parent=gA
    const firstAdd = cy.__addCalls.find((c) => c.data.id === 'w1')!;
    expect(firstAdd.data.parent).toBe('gA');

    // Capture the existing element before re-sync
    const existing = cy.__elements.get('w1')!;

    // Re-sync with w1 reparented to gB
    const w1moved = wallet('w1', { groupId: 'gB' });
    const t2 = trace('trace-a', { nodes: [w1moved], groups: [gA, gB] });
    syncCytoscape(cy, inv([t2]));

    expect(existing.move).toHaveBeenCalled();
    expect(existing.__moveCalls.some((c) => c.parent === 'gB')).toBe(true);
  });

  it('7. cross-trace bundled edge: individual edge not rendered when bundle collapsed', () => {
    const wA1 = wallet('wA1', { parentTrace: 'trace-a' });
    const wB1 = wallet('wB1', { parentTrace: 'trace-b' });
    const crossEdge = edge('eX', 'wA1', 'wB1', { crossTrace: true });
    const bundle: EdgeBundle = {
      id: 'bX',
      traceId: 'trace-a',
      fromNodeId: 'wA1',
      toNodeId: 'wB1',
      token: 'USDC',
      collapsed: true,
      edgeIds: ['eX'],
    };
    const tA = trace('trace-a', { nodes: [wA1], edges: [crossEdge], edgeBundles: [bundle] });
    const tB = trace('trace-b', { nodes: [wB1] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([tA, tB]));

    const ids = cy.__addCalls.map((c) => c.data.id);
    expect(ids).not.toContain('eX');
    expect(ids).toContain('bX');

    const bundleCall = cy.__addCalls.find((c) => c.data.id === 'bX')!;
    expect(bundleCall.data.source).toBe('wA1');
    expect(bundleCall.data.target).toBe('wB1');
  });

  it('8. deletion cascades: removing a wallet removes the node and its connected edges', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const w3 = wallet('w3');
    const e12 = edge('e12', 'w1', 'w2');
    const e23 = edge('e23', 'w2', 'w3');
    const t1 = trace('trace-a', { nodes: [w1, w2, w3], edges: [e12, e23] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t1]));

    // Sanity: all three wallets and both edges present
    expect(cy.__elements.get('w2')!.__removed).toBe(false);
    expect(cy.__elements.get('e12')!.__removed).toBe(false);
    expect(cy.__elements.get('e23')!.__removed).toBe(false);

    // Re-sync without w2 — w2 should be removed and its connected edges
    // (e12, e23) should not survive in the live registry.
    const t2 = trace('trace-a', { nodes: [w1, w3], edges: [] });
    syncCytoscape(cy, inv([t2]));

    expect(cy.__elements.get('w2')!.__removed).toBe(true);
    expect(cy.__elements.get('w2')!.remove).toHaveBeenCalled();
    expect(cy.__elements.get('e12')!.__removed).toBe(true);
    expect(cy.__elements.get('e23')!.__removed).toBe(true);
  });

  it('9. tx junction node: maps kind/shape/size/label/color from node.kind', () => {
    const junction = wallet('j1', {
      kind: 'txJunction',
      label: '3 in / 2 out',
      address: 'deadbeef',
    });
    const t = trace('trace-a', { nodes: [junction] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const call = cy.__addCalls.find((c) => c.data.id === 'j1')!;
    expect(call.data.kind).toBe('txJunction');
    expect(call.data.nodeShape).toBe('rectangle');
    expect(call.data.size).toBe(28);
    expect(call.data.label).toBe('3 in / 2 out');
    expect(call.data.displayLabel).toBe('3 in / 2 out');
    expect(call.data.color).toBe('#64748b');
  });

  it('10. tx junction node respects explicit size/color overrides', () => {
    const junction = wallet('j1', { kind: 'txJunction', label: '1 in / 1 out', size: 40, color: '#ff0000' });
    const t = trace('trace-a', { nodes: [junction] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const call = cy.__addCalls.find((c) => c.data.id === 'j1')!;
    expect(call.data.size).toBe(40);
    expect(call.data.color).toBe('#ff0000');
  });

  it('11. ordinary wallet node is unaffected by the junction branch (regression)', () => {
    const w = wallet('w1', { label: 'Hot Wallet', address: '0xabcdef1234567890' });
    const t = trace('trace-a', { nodes: [w] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const call = cy.__addCalls.find((c) => c.data.id === 'w1')!;
    expect(call.data.kind).toBeUndefined();
    expect(call.data.nodeShape).toBe('ellipse');
    expect(call.data.size).toBe(60);
    expect(call.data.displayLabel).toBe('Hot Wallet');
  });

  it('12. aggregated BTC edge keeps sub-1 precision in its label (regression: "0 BTC")', () => {
    const g: Group = { id: 'g1', name: 'Group 1', traceId: 'trace-a', collapsed: true };
    const w1 = wallet('w1', { chain: 'bitcoin' });
    const w2 = wallet('w2', { chain: 'bitcoin', groupId: 'g1' });
    const w3 = wallet('w3', { chain: 'bitcoin', groupId: 'g1' });
    const btc = { address: '', symbol: 'BTC', decimals: 8 };
    // 514,179 + 624,660 sats = 0.01138839 BTC — must not render as "0 BTC (2)"
    const e1 = edge('e1', 'w1', 'w2', { chain: 'bitcoin', token: btc, amount: '514179' });
    const e2 = edge('e2', 'w1', 'w3', { chain: 'bitcoin', token: btc, amount: '624660' });
    const t = trace('trace-a', { nodes: [w1, w2, w3], edges: [e1, e2], groups: [g] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const agg = cy.__addCalls.find((c) => c.data.isAggregatedEdge)!;
    expect(agg).toBeDefined();
    expect(agg.data.label).toBe('0.0113 BTC (2)');
  });

  it('13. aggregated BTC edge below 0.0001 keeps extended precision', () => {
    const g: Group = { id: 'g1', name: 'Group 1', traceId: 'trace-a', collapsed: true };
    const w1 = wallet('w1', { chain: 'bitcoin' });
    const w2 = wallet('w2', { chain: 'bitcoin', groupId: 'g1' });
    const btc = { address: '', symbol: 'BTC', decimals: 8 };
    const e1 = edge('e1', 'w1', 'w2', { chain: 'bitcoin', token: btc, amount: '7900' });
    const t = trace('trace-a', { nodes: [w1, w2], edges: [e1], groups: [g] });
    const cy = makeFakeCy();

    syncCytoscape(cy, inv([t]));

    const agg = cy.__addCalls.find((c) => c.data.isAggregatedEdge)!;
    expect(agg.data.label).toBe('0.000079 BTC');
  });
});
