import { resolveEndpointLabel, resolveFocusItem } from './focusItem';
import type {
  Investigation,
  Trace,
  WalletNode,
  TransactionEdge,
  Group,
  EdgeBundle,
} from '../types/investigation';
import type { FocusItem } from '../hooks/useCytoscape';

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

function group(id: string, traceId: string, overrides: Partial<Group> = {}): Group {
  return {
    id,
    name: id,
    traceId,
    collapsed: false,
    ...overrides,
  };
}

function bundle(id: string, traceId: string, overrides: Partial<EdgeBundle> = {}): EdgeBundle {
  return {
    id,
    traceId,
    fromNodeId: 'wallet-a',
    toNodeId: 'wallet-b',
    token: 'USDC',
    collapsed: false,
    edgeIds: [],
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

// ── resolveEndpointLabel ──────────────────────────────────────────────────────

describe('resolveEndpointLabel', () => {
  it('returns "TraceName (N)" when trace is collapsed', () => {
    const t = trace('trace-a', { name: 'Alpha', collapsed: true, nodes: [wallet('w1'), wallet('w2')] });
    const investigation = inv([t]);
    expect(resolveEndpointLabel('trace-a', investigation)).toBe('Alpha (2)');
  });

  it('returns trace name when trace is expanded', () => {
    const t = trace('trace-a', { name: 'Alpha', collapsed: false });
    const investigation = inv([t]);
    expect(resolveEndpointLabel('trace-a', investigation)).toBe('Alpha');
  });

  it('returns "GroupName (count)" when group is collapsed', () => {
    const w1 = wallet('w1', { groupId: 'grp-1' });
    const w2 = wallet('w2', { groupId: 'grp-1' });
    const g = group('grp-1', 'trace-a', { name: 'MyGroup', collapsed: true });
    const t = trace('trace-a', { nodes: [w1, w2], groups: [g] });
    const investigation = inv([t]);
    expect(resolveEndpointLabel('grp-1', investigation)).toBe('MyGroup (2)');
  });

  it('returns group name when group is expanded', () => {
    const g = group('grp-1', 'trace-a', { name: 'MyGroup', collapsed: false });
    const t = trace('trace-a', { groups: [g] });
    const investigation = inv([t]);
    expect(resolveEndpointLabel('grp-1', investigation)).toBe('MyGroup');
  });

  it('returns wallet.label when set', () => {
    const w = wallet('w1', { label: 'Binance Hot Wallet', address: '0xabc123' });
    const t = trace('trace-a', { nodes: [w] });
    const investigation = inv([t]);
    expect(resolveEndpointLabel('w1', investigation)).toBe('Binance Hot Wallet');
  });

  it('returns truncated address when wallet has no label', () => {
    // address longer than 10 chars → "${first6}…${last4}"
    const w = wallet('w1', { label: '', address: '0xabcdef1234567890' });
    const t = trace('trace-a', { nodes: [w] });
    const investigation = inv([t]);
    expect(resolveEndpointLabel('w1', investigation)).toBe('0xabcd…7890');
  });

  it('returns first-8-then-ellipsis fallback for unknown id', () => {
    const investigation = inv([trace('trace-a')]);
    expect(resolveEndpointLabel('abcdefghij', investigation)).toBe('abcdefgh…');
  });
});

// ── resolveFocusItem ──────────────────────────────────────────────────────────

describe('resolveFocusItem', () => {
  it('returns null when focusItem is null', () => {
    const investigation = inv([trace('trace-a')]);
    expect(resolveFocusItem(null, investigation)).toBeNull();
  });

  it('returns null when investigation is null', () => {
    const focusItem: FocusItem = { type: 'trace', id: 'trace-a' };
    expect(resolveFocusItem(focusItem, null)).toBeNull();
  });

  it('resolves trace focusItem to the trace', () => {
    const t = trace('trace-a', { name: 'Alpha' });
    const investigation = inv([t]);
    const focusItem: FocusItem = { type: 'trace', id: 'trace-a' };
    const result = resolveFocusItem(focusItem, investigation);
    expect(result).toEqual({ type: 'trace', data: t });
  });

  it('resolves wallet focusItem', () => {
    const w = wallet('w1', { label: 'Hot Wallet' });
    const t = trace('trace-a', { nodes: [w] });
    const investigation = inv([t]);
    const focusItem: FocusItem = { type: 'wallet', id: 'w1', traceId: 'trace-a' };
    const result = resolveFocusItem(focusItem, investigation);
    expect(result).toEqual({ type: 'wallet', data: w });
  });

  it('resolves txJunction focusItem to the node', () => {
    const j = wallet('j1', { kind: 'txJunction', label: '3 in / 2 out', address: 'deadbeef' });
    const t = trace('trace-a', { nodes: [j] });
    const investigation = inv([t]);
    const focusItem: FocusItem = { type: 'txJunction', id: 'j1', traceId: 'trace-a' };
    const result = resolveFocusItem(focusItem, investigation);
    expect(result).toEqual({ type: 'txJunction', data: j });
  });

  it('returns null for a txJunction focusItem with no matching node', () => {
    const t = trace('trace-a');
    const investigation = inv([t]);
    const focusItem: FocusItem = { type: 'txJunction', id: 'missing', traceId: 'trace-a' };
    expect(resolveFocusItem(focusItem, investigation)).toBeNull();
  });

  it('resolves group focusItem', () => {
    const g = group('grp-1', 'trace-a', { name: 'MyGroup' });
    const t = trace('trace-a', { groups: [g] });
    const investigation = inv([t]);
    const focusItem: FocusItem = { type: 'group', id: 'grp-1', traceId: 'trace-a' };
    const result = resolveFocusItem(focusItem, investigation);
    expect(result).toEqual({ type: 'group', data: g });
  });

  it('resolves transaction focusItem', () => {
    const tx = edge('tx-1', 'w1', 'w2');
    const t = trace('trace-a', { edges: [tx] });
    const investigation = inv([t]);
    const focusItem: FocusItem = { type: 'transaction', id: 'tx-1', traceId: 'trace-a' };
    const result = resolveFocusItem(focusItem, investigation);
    expect(result).toEqual({ type: 'transaction', data: tx });
  });

  it('resolves edgeBundle focusItem', () => {
    const b = bundle('bundle-1', 'trace-a', { edgeIds: ['tx-1', 'tx-2'] });
    const t = trace('trace-a', { edgeBundles: [b] });
    const investigation = inv([t]);
    const focusItem: FocusItem = { type: 'edgeBundle', id: 'bundle-1', traceId: 'trace-a' };
    const result = resolveFocusItem(focusItem, investigation);
    expect(result).toEqual({ type: 'edgeBundle', data: b });
  });

  it('returns null for aggregatedEdge when underlying edges were deleted (race condition)', () => {
    // The trace exists but the edges referenced by edgeIds are gone
    const t = trace('trace-a', { edges: [] });
    const investigation = inv([t]);
    const focusItem: FocusItem = {
      type: 'aggregatedEdge',
      id: 'w1::w2::USDC',
      traceId: 'trace-a',
      edgeIds: ['tx-deleted-1', 'tx-deleted-2'],
    };
    expect(resolveFocusItem(focusItem, investigation)).toBeNull();
  });

  it('parses src/tgt from synthetic edge id for aggregatedEdge', () => {
    const tx1 = edge('tx-1', 'w1', 'w2');
    const tx2 = edge('tx-2', 'w1', 'w2');
    const wSrc = wallet('w1', { label: 'Source Wallet' });
    const wTgt = wallet('w2', { label: 'Target Wallet' });
    const t = trace('trace-a', { nodes: [wSrc, wTgt], edges: [tx1, tx2] });
    const investigation = inv([t]);

    // Synthetic id format: "${effFrom}::${effTo}::${tokenKey}"
    const focusItem: FocusItem = {
      type: 'aggregatedEdge',
      id: 'w1::w2::USDC',
      traceId: 'trace-a',
      edgeIds: ['tx-1', 'tx-2'],
    };
    const result = resolveFocusItem(focusItem, investigation);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('aggregatedEdge');
    expect(result!.data.edges).toEqual([tx1, tx2]);
    expect(result!.data.traceId).toBe('trace-a');
    expect(result!.data.fromNodeId).toBe('w1');
    expect(result!.data.toNodeId).toBe('w2');
    expect(result!.data.fromLabel).toBe('Source Wallet');
    expect(result!.data.toLabel).toBe('Target Wallet');
    expect(result!.data.syntheticEdgeId).toBe('w1::w2::USDC');
  });
});
