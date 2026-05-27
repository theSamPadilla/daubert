import { applyArcDelta } from './arcEdge';
import type {
  Investigation,
  Trace,
  WalletNode,
  TransactionEdge,
  EdgeBundle,
} from '@/types/investigation';

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

function bundle(id: string, fromNodeId: string, toNodeId: string, overrides: Partial<EdgeBundle> = {}): EdgeBundle {
  return {
    id,
    traceId: 'trace-a',
    fromNodeId,
    toNodeId,
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyArcDelta', () => {
  it('returns false when investigation is null', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const result = applyArcDelta(null, 'e1', 5, mutators);
    expect(result).toBe(false);
    expect(mutators.updateTransaction).not.toHaveBeenCalled();
    expect(mutators.updateEdgeBundle).not.toHaveBeenCalled();
  });

  it('returns false when edgeId matches neither a transaction nor a bundle', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const investigation = inv([trace('t1', { edges: [edge('e1', 'w1', 'w2')] })]);
    const result = applyArcDelta(investigation, 'no-such-edge', 5, mutators);
    expect(result).toBe(false);
    expect(mutators.updateTransaction).not.toHaveBeenCalled();
    expect(mutators.updateEdgeBundle).not.toHaveBeenCalled();
  });

  it('persists hasArc + accumulated arcOffset to TransactionEdge', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const investigation = inv([trace('t1', { edges: [edge('e1', 'w1', 'w2', { arcOffset: 10 })] })]);
    const result = applyArcDelta(investigation, 'e1', 5, mutators);
    expect(result).toBe(true);
    expect(mutators.updateTransaction).toHaveBeenCalledWith('t1', 'e1', { hasArc: true, arcOffset: 15 });
    expect(mutators.updateEdgeBundle).not.toHaveBeenCalled();
  });

  it('resets TransactionEdge arc when delta is null', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const investigation = inv([trace('t1', { edges: [edge('e1', 'w1', 'w2', { arcOffset: 10 })] })]);
    applyArcDelta(investigation, 'e1', null, mutators);
    expect(mutators.updateTransaction).toHaveBeenCalledWith('t1', 'e1', { hasArc: undefined, arcOffset: undefined });
  });

  it('persists to EdgeBundle when edgeId matches a bundle', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const b = bundle('b1', 'w1', 'w2', { arcOffset: 20 });
    const investigation = inv([trace('t1', { edgeBundles: [b] })]);
    const result = applyArcDelta(investigation, 'b1', 3, mutators);
    expect(result).toBe(true);
    expect(mutators.updateEdgeBundle).toHaveBeenCalledWith('t1', 'b1', { hasArc: true, arcOffset: 23 });
    expect(mutators.updateTransaction).not.toHaveBeenCalled();
  });

  it('resets EdgeBundle arc when delta is null', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const b = bundle('b1', 'w1', 'w2', { arcOffset: 20 });
    const investigation = inv([trace('t1', { edgeBundles: [b] })]);
    applyArcDelta(investigation, 'b1', null, mutators);
    expect(mutators.updateEdgeBundle).toHaveBeenCalledWith('t1', 'b1', { hasArc: undefined, arcOffset: undefined });
    expect(mutators.updateTransaction).not.toHaveBeenCalled();
  });

  it('treats undefined arcOffset as 0', () => {
    const mutators = { updateTransaction: jest.fn(), updateEdgeBundle: jest.fn() };
    const investigation = inv([trace('t1', { edges: [edge('e1', 'w1', 'w2')] })]); // no arcOffset
    applyArcDelta(investigation, 'e1', 7, mutators);
    expect(mutators.updateTransaction).toHaveBeenCalledWith('t1', 'e1', { hasArc: true, arcOffset: 7 });
  });
});
