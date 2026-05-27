import {
  computeDirectionalBundlingPlan,
  computeSelectionBundlingPlan,
} from './edgeBundling';
import type {
  Investigation,
  Trace,
  WalletNode,
  TransactionEdge,
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

function edge(
  id: string,
  from: string,
  to: string,
  overrides: Partial<TransactionEdge> = {},
): TransactionEdge {
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

function bundle(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  edgeIds: string[],
  overrides: Partial<EdgeBundle> = {},
): EdgeBundle {
  return {
    id,
    traceId: 'trace-a',
    fromNodeId,
    toNodeId,
    token: 'USDC',
    collapsed: true,
    edgeIds,
    ...overrides,
  };
}

// ── computeDirectionalBundlingPlan — outbound ─────────────────────────────────

describe('computeDirectionalBundlingPlan — outbound', () => {
  it('returns null when wallet is not in any trace', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const t = trace('trace-a', { nodes: [w1, w2], edges: [e1] });

    const result = computeDirectionalBundlingPlan(inv([t]), 'w-nonexistent', 'outbound');

    expect(result).toBeNull();
  });

  it('returns null when wallet has no outbound edges', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    // Only inbound edge to w1
    const e1 = edge('e1', 'w2', 'w1');
    const t = trace('trace-a', { nodes: [w1, w2], edges: [e1] });

    const result = computeDirectionalBundlingPlan(inv([t]), 'w1', 'outbound');

    expect(result).toBeNull();
  });

  it('groups outbound edges to same counterparty + token into one planned bundle', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2');
    const t = trace('trace-a', { nodes: [w1, w2], edges: [e1, e2] });

    const result = computeDirectionalBundlingPlan(inv([t]), 'w1', 'outbound');

    expect(result).not.toBeNull();
    expect(result!.newBundles).toHaveLength(1);
    expect(result!.newBundles[0].edgeIds).toEqual(expect.arrayContaining(['e1', 'e2']));
    expect(result!.newBundles[0].edgeIds).toHaveLength(2);
    expect(result!.newBundles[0].fromNodeId).toBe('w1');
    expect(result!.newBundles[0].toNodeId).toBe('w2');
    expect(result!.newBundles[0].token).toBe('USDC');
  });

  it('does not bundle single-edge groups', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const w3 = wallet('w3');
    // One edge to w2 and one edge to w3 — no group has >= 2 edges
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w3');
    const t = trace('trace-a', { nodes: [w1, w2, w3], edges: [e1, e2] });

    const result = computeDirectionalBundlingPlan(inv([t]), 'w1', 'outbound');

    // affectedEdgeIds is not empty (w1 has outbound edges), so result != null
    expect(result).not.toBeNull();
    // But no group has 2+ edges, so newBundles should be empty
    expect(result!.newBundles).toHaveLength(0);
  });

  it('consumes existing bundles where wallet is the fromNodeId', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2');
    const e3 = edge('e3', 'w1', 'w2');
    const existingBundle = bundle('b1', 'w1', 'w2', ['e1', 'e2'], { traceId: 'trace-a' });
    // e3 is a raw edge not yet in any bundle
    const t = trace('trace-a', {
      nodes: [w1, w2],
      edges: [e1, e2, e3],
      edgeBundles: [existingBundle],
    });

    const result = computeDirectionalBundlingPlan(inv([t]), 'w1', 'outbound');

    expect(result).not.toBeNull();
    // The existing bundle should be consumed
    expect(result!.consumedBundleIds).toEqual(
      expect.arrayContaining([{ traceId: 'trace-a', bundleId: 'b1' }]),
    );
    expect(result!.consumedBundleIds).toHaveLength(1);
    // All three edge ids should be in affectedEdgeIds
    expect(result!.affectedEdgeIds.has('e1')).toBe(true);
    expect(result!.affectedEdgeIds.has('e2')).toBe(true);
    expect(result!.affectedEdgeIds.has('e3')).toBe(true);
  });

  it('groups by counterparty ADDRESS, not node id (so cross-trace dupes collapse)', () => {
    // w2 and w2b are different node ids but share the same address 0xaddr-target
    const w1 = wallet('w1', { address: '0xaddr-source' });
    const w2 = wallet('w2', { address: '0xaddr-target' });
    const w2b = wallet('w2b', { address: '0xaddr-target', parentTrace: 'trace-b' });
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2b');
    const tA = trace('trace-a', { nodes: [w1, w2], edges: [e1] });
    const tB = trace('trace-b', { nodes: [w2b], edges: [e2] });

    const result = computeDirectionalBundlingPlan(inv([tA, tB]), 'w1', 'outbound');

    expect(result).not.toBeNull();
    // Both edges go to 0xaddr-target, so they should collapse into one group
    expect(result!.newBundles).toHaveLength(1);
    expect(result!.newBundles[0].edgeIds).toEqual(expect.arrayContaining(['e1', 'e2']));
    expect(result!.newBundles[0].edgeIds).toHaveLength(2);
  });
});

// ── computeDirectionalBundlingPlan — inbound ──────────────────────────────────

describe('computeDirectionalBundlingPlan — inbound', () => {
  it('groups inbound edges by source address + token', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const w3 = wallet('w3');
    // w2 and w3 both send to w1 with the same token — but they are different
    // source addresses, so they should form two separate groups (each with 1 edge)
    const e1 = edge('e1', 'w2', 'w1');
    const e2 = edge('e2', 'w2', 'w1'); // same source as e1 — should group with e1
    const e3 = edge('e3', 'w3', 'w1'); // different source — separate group
    const t = trace('trace-a', { nodes: [w1, w2, w3], edges: [e1, e2, e3] });

    const result = computeDirectionalBundlingPlan(inv([t]), 'w1', 'inbound');

    expect(result).not.toBeNull();
    // e1+e2 group together (same source w2, same token); e3 is a single group (skipped)
    expect(result!.newBundles).toHaveLength(1);
    expect(result!.newBundles[0].edgeIds).toEqual(expect.arrayContaining(['e1', 'e2']));
    expect(result!.newBundles[0].edgeIds).toHaveLength(2);
    expect(result!.newBundles[0].fromNodeId).toBe('w2');
    expect(result!.newBundles[0].toNodeId).toBe('w1');
  });

  it('consumes existing bundles where wallet is the toNodeId', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w2', 'w1');
    const e2 = edge('e2', 'w2', 'w1');
    const existingBundle = bundle('b2', 'w2', 'w1', ['e1', 'e2'], { traceId: 'trace-a' });
    const t = trace('trace-a', {
      nodes: [w1, w2],
      edges: [e1, e2],
      edgeBundles: [existingBundle],
    });

    const result = computeDirectionalBundlingPlan(inv([t]), 'w1', 'inbound');

    expect(result).not.toBeNull();
    expect(result!.consumedBundleIds).toEqual(
      expect.arrayContaining([{ traceId: 'trace-a', bundleId: 'b2' }]),
    );
    expect(result!.consumedBundleIds).toHaveLength(1);
    expect(result!.affectedEdgeIds.has('e1')).toBe(true);
    expect(result!.affectedEdgeIds.has('e2')).toBe(true);
  });
});

// ── computeSelectionBundlingPlan ──────────────────────────────────────────────

describe('computeSelectionBundlingPlan', () => {
  it('expands selected bundle ids into their underlying edge ids', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2');
    const existingBundle = bundle('b1', 'w1', 'w2', ['e1', 'e2'], { traceId: 'trace-a' });
    const e3 = edge('e3', 'w1', 'w2');
    const t = trace('trace-a', {
      nodes: [w1, w2],
      edges: [e1, e2, e3],
      edgeBundles: [existingBundle],
    });

    // Select the existing bundle + a raw edge: all three edges should be in the new group
    const result = computeSelectionBundlingPlan(inv([t]), ['b1', 'e3']);

    expect(result.consumedBundleIds).toEqual(
      expect.arrayContaining([{ traceId: 'trace-a', bundleId: 'b1' }]),
    );
    expect(result.newBundles).toHaveLength(1);
    expect(result.newBundles[0].bundle.edgeIds).toEqual(
      expect.arrayContaining(['e1', 'e2', 'e3']),
    );
    expect(result.newBundles[0].bundle.edgeIds).toHaveLength(3);
  });

  it('dedupes when both a raw edge and a bundle containing it are selected', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2');
    const existingBundle = bundle('b1', 'w1', 'w2', ['e1', 'e2'], { traceId: 'trace-a' });
    const t = trace('trace-a', {
      nodes: [w1, w2],
      edges: [e1, e2],
      edgeBundles: [existingBundle],
    });

    // e1 is already inside b1; selecting both should not produce duplicates
    const result = computeSelectionBundlingPlan(inv([t]), ['b1', 'e1']);

    expect(result.newBundles).toHaveLength(1);
    const bundledEdgeIds = result.newBundles[0].bundle.edgeIds;
    // e1 must appear exactly once
    const e1Count = bundledEdgeIds.filter((id) => id === 'e1').length;
    expect(e1Count).toBe(1);
    expect(bundledEdgeIds).toHaveLength(2);
  });

  it('groups by (from, to, token)', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const w3 = wallet('w3');
    // Two edges from w1→w2 (same group) and one from w1→w3 (different group)
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w2');
    const e3 = edge('e3', 'w1', 'w3');
    const e4 = edge('e4', 'w1', 'w3');
    const t = trace('trace-a', { nodes: [w1, w2, w3], edges: [e1, e2, e3, e4] });

    const result = computeSelectionBundlingPlan(inv([t]), ['e1', 'e2', 'e3', 'e4']);

    expect(result.newBundles).toHaveLength(2);
    const group1 = result.newBundles.find(
      (b) => b.bundle.fromNodeId === 'w1' && b.bundle.toNodeId === 'w2',
    );
    const group2 = result.newBundles.find(
      (b) => b.bundle.fromNodeId === 'w1' && b.bundle.toNodeId === 'w3',
    );
    expect(group1).toBeDefined();
    expect(group2).toBeDefined();
    expect(group1!.bundle.edgeIds).toEqual(expect.arrayContaining(['e1', 'e2']));
    expect(group2!.bundle.edgeIds).toEqual(expect.arrayContaining(['e3', 'e4']));
  });

  it('skips single-edge groups', () => {
    const w1 = wallet('w1');
    const w2 = wallet('w2');
    const w3 = wallet('w3');
    // One edge to w2, one to w3 — no (from,to,token) group has 2+ edges
    const e1 = edge('e1', 'w1', 'w2');
    const e2 = edge('e2', 'w1', 'w3');
    const t = trace('trace-a', { nodes: [w1, w2, w3], edges: [e1, e2] });

    const result = computeSelectionBundlingPlan(inv([t]), ['e1', 'e2']);

    expect(result.newBundles).toHaveLength(0);
  });

  it('attributes each new bundle to the trace containing the first edge', () => {
    const wA = wallet('wA', { parentTrace: 'trace-a' });
    const wB = wallet('wB', { parentTrace: 'trace-a', address: '0xaddr-b' });
    const e1 = edge('e1', 'wA', 'wB');
    const e2 = edge('e2', 'wA', 'wB');
    const tA = trace('trace-a', { nodes: [wA, wB], edges: [e1, e2] });
    // A second trace that doesn't contain these edges
    const tB = trace('trace-b', { nodes: [], edges: [] });

    const result = computeSelectionBundlingPlan(inv([tA, tB]), ['e1', 'e2']);

    expect(result.newBundles).toHaveLength(1);
    // The new bundle should be attributed to trace-a (where e1 lives)
    expect(result.newBundles[0].traceId).toBe('trace-a');
  });
});
