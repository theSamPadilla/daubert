import {
  stripTraceForAgent,
  filterTraceData,
  AgentTraceData,
} from './investigation-data.utils';

// ── Sample data ───────────────────────────────────────────────────────────────
// 4 nodes (0xDDD is intentionally isolated — referenced by no edge),
// 3 edges, 1 group, 1 edge bundle.

const SAMPLE_DATA: Record<string, unknown> = {
  nodes: [
    {
      id: 'n-aaa',
      address: '0xAAA',
      chain: 'ethereum',
      label: 'Alpha',
      tags: ['suspect'],
      notes: 'top of trace',
      addressType: 'eoa',
      groupId: 'g1',
      // visual fields that should be dropped:
      position: { x: 10, y: 20 },
      color: '#f59e0b',
      shape: 'diamond',
      size: 60,
      explorerUrl: 'https://etherscan.io/address/0xAAA',
      parentTrace: 'trace-1',
    },
    {
      id: 'n-bbb',
      address: '0xBBB',
      chain: 'ethereum',
      label: 'Beta',
      tags: [],
      addressType: 'contract',
      groupId: 'g1',
      position: { x: 100, y: 200 },
      color: '#000',
      shape: 'circle',
      size: 40,
      explorerUrl: 'https://etherscan.io/address/0xBBB',
      parentTrace: 'trace-1',
    },
    {
      id: 'n-ccc',
      address: '0xCCC',
      chain: 'ethereum',
      label: 'Gamma',
      tags: ['exchange'],
      position: { x: 200, y: 300 },
      color: '#fff',
      shape: 'diamond',
      size: 60,
      explorerUrl: 'https://etherscan.io/address/0xCCC',
      parentTrace: 'trace-1',
    },
    {
      // isolated node — no incident edges
      id: 'n-ddd',
      address: '0xDDD',
      chain: 'ethereum',
      label: 'Delta',
      tags: [],
      position: { x: 999, y: 999 },
      color: '#abc',
      shape: 'circle',
      size: 50,
      explorerUrl: 'https://etherscan.io/address/0xDDD',
      parentTrace: 'trace-1',
    },
  ],
  edges: [
    {
      id: 'e1',
      from: 'n-aaa',
      to: 'n-bbb',
      txHash: '0xtx1',
      chain: 'ethereum',
      timestamp: '1709500000',
      amount: '1.5',
      token: 'ETH',
      blockNumber: 19000000,
      tags: ['large'],
      notes: 'first hop',
      crossTrace: false,
      // visual:
      color: null,
      lineStyle: 'dashed',
      label: null,
    },
    {
      id: 'e2',
      from: 'n-bbb',
      to: 'n-ccc',
      txHash: '0xtx2',
      chain: 'ethereum',
      timestamp: '1709500001',
      amount: '500',
      token: 'USDT',
      blockNumber: 19000001,
      tags: [],
      crossTrace: true,
      color: '#fff',
      lineStyle: 'solid',
      label: null,
    },
    {
      id: 'e3',
      from: 'n-aaa',
      to: 'n-ccc',
      txHash: '0xtx3',
      chain: 'ethereum',
      timestamp: '1709500002',
      amount: '0.25',
      token: 'ETH',
      tags: [],
      color: null,
      lineStyle: null,
      label: null,
    },
  ],
  groups: [
    {
      id: 'g1',
      name: 'Exchange Wallets',
      color: '#f59e0b',
      traceId: 'trace-1',
      collapsed: false,
    },
  ],
  edgeBundles: [
    {
      id: 'b1',
      fromNodeId: 'n-aaa',
      toNodeId: 'n-ccc',
      token: 'ETH',
      collapsed: false,
      edgeIds: ['e1', 'e3'],
      color: null,
    },
  ],
};

describe('stripTraceForAgent', () => {
  it('handles empty data', () => {
    const result = stripTraceForAgent({});
    expect(result).toEqual({
      nodes: [],
      edges: [],
      groups: [],
      edgeBundles: [],
    });
  });

  it('handles undefined nested fields', () => {
    const result = stripTraceForAgent({
      nodes: undefined,
      edges: undefined,
    } as any);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.edgeBundles).toEqual([]);
  });

  it('keeps semantic fields on nodes (addressType, groupId)', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    const alpha = result.nodes.find((n) => n.id === 'n-aaa')!;
    expect(alpha.addressType).toBe('eoa');
    expect(alpha.groupId).toBe('g1');
    expect(alpha.notes).toBe('top of trace');
    expect(alpha.tags).toEqual(['suspect']);
    expect(alpha.address).toBe('0xAAA');
    expect(alpha.chain).toBe('ethereum');
    expect(alpha.label).toBe('Alpha');
  });

  it('drops visual fields from nodes', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    for (const n of result.nodes) {
      expect(n).not.toHaveProperty('position');
      expect(n).not.toHaveProperty('color');
      expect(n).not.toHaveProperty('shape');
      expect(n).not.toHaveProperty('size');
      expect(n).not.toHaveProperty('explorerUrl');
      expect(n).not.toHaveProperty('parentTrace');
    }
  });

  it('keeps semantic fields on edges (crossTrace, blockNumber)', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    const e1 = result.edges.find((e) => e.id === 'e1')!;
    expect(e1.blockNumber).toBe(19000000);
    expect(e1.crossTrace).toBeUndefined(); // false → undefined per impl
    const e2 = result.edges.find((e) => e.id === 'e2')!;
    expect(e2.crossTrace).toBe(true);
    expect(e2.blockNumber).toBe(19000001);
  });

  it('drops visual fields from edges', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    for (const e of result.edges) {
      expect(e).not.toHaveProperty('color');
      expect(e).not.toHaveProperty('lineStyle');
      expect(e).not.toHaveProperty('label');
    }
  });

  it('denormalizes edges with fromAddress/toAddress', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    const e1 = result.edges.find((e) => e.id === 'e1')!;
    expect(e1.fromAddress).toBe('0xAAA');
    expect(e1.toAddress).toBe('0xBBB');
    const e3 = result.edges.find((e) => e.id === 'e3')!;
    expect(e3.fromAddress).toBe('0xAAA');
    expect(e3.toAddress).toBe('0xCCC');
  });

  it('returns null fromAddress/toAddress when node id is unknown', () => {
    const data = {
      nodes: [{ id: 'n1', address: '0xaaa' }],
      edges: [{ id: 'e1', from: 'n1', to: 'orphan' }],
    };
    const result = stripTraceForAgent(data);
    expect(result.edges[0].fromAddress).toBe('0xaaa');
    expect(result.edges[0].toAddress).toBeNull();
  });

  it('preserves all edge primary fields', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    const e2 = result.edges.find((e) => e.id === 'e2')!;
    expect(e2.txHash).toBe('0xtx2');
    expect(e2.chain).toBe('ethereum');
    expect(e2.timestamp).toBe('1709500001');
    expect(e2.amount).toBe('500');
    expect(e2.token).toBe('USDT');
  });

  it('includes slim groups with derived nodeIds', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    expect(result.groups).toHaveLength(1);
    const g1 = result.groups[0];
    expect(g1.id).toBe('g1');
    expect(g1.name).toBe('Exchange Wallets');
    expect(new Set(g1.nodeIds)).toEqual(new Set(['n-aaa', 'n-bbb']));
    // visual color/traceId/collapsed should not be present on slim group
    expect(g1).not.toHaveProperty('color');
    expect(g1).not.toHaveProperty('traceId');
    expect(g1).not.toHaveProperty('collapsed');
  });

  it('includes slim edge bundles', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    expect(result.edgeBundles).toHaveLength(1);
    const b = result.edgeBundles[0];
    expect(b.id).toBe('b1');
    expect(b.fromNodeId).toBe('n-aaa');
    expect(b.toNodeId).toBe('n-ccc');
    expect(b.token).toBe('ETH');
    expect(b.edgeIds).toEqual(['e1', 'e3']);
    expect(b).not.toHaveProperty('color');
    expect(b).not.toHaveProperty('collapsed');
  });

  it('includes the isolated node 0xDDD in nodes (zero edges)', () => {
    const result = stripTraceForAgent(SAMPLE_DATA);
    const delta = result.nodes.find((n) => n.id === 'n-ddd');
    expect(delta).toBeDefined();
    expect(delta!.address).toBe('0xDDD');
  });
});

describe('filterTraceData', () => {
  let stripped: AgentTraceData;

  beforeEach(() => {
    stripped = stripTraceForAgent(SAMPLE_DATA);
  });

  it('returns all data when no filters provided', () => {
    const result = filterTraceData(stripped);
    expect(result).toBe(stripped); // pass-through
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(3);
  });

  it('address filter returns matching node + incident edges + neighbors', () => {
    const result = filterTraceData(stripped, '0xAAA');
    // Edges with n-aaa as endpoint: e1 (aaa→bbb), e3 (aaa→ccc)
    expect(result.edges.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
    // Nodes kept: n-aaa (matched) + n-bbb (e1 neighbor) + n-ccc (e3 neighbor)
    expect(new Set(result.nodes.map((n) => n.id))).toEqual(
      new Set(['n-aaa', 'n-bbb', 'n-ccc']),
    );
    // n-ddd (isolated, not matched) excluded
    expect(result.nodes.find((n) => n.id === 'n-ddd')).toBeUndefined();
  });

  it('address filter keeps an isolated matched node even with zero edges', () => {
    const result = filterTraceData(stripped, '0xDDD');
    expect(result.edges).toEqual([]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('n-ddd');
  });

  it('address filter is case-insensitive', () => {
    const lower = filterTraceData(stripped, '0xaaa');
    const upper = filterTraceData(stripped, '0xAAA');
    expect(lower.nodes.map((n) => n.id).sort()).toEqual(
      upper.nodes.map((n) => n.id).sort(),
    );
    expect(lower.edges.map((e) => e.id).sort()).toEqual(
      upper.edges.map((e) => e.id).sort(),
    );
  });

  it('token filter limits edges to that symbol', () => {
    const result = filterTraceData(stripped, undefined, 'ETH');
    expect(result.edges.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
    // Surviving nodes are those touched by ETH edges: aaa, bbb, ccc
    expect(new Set(result.nodes.map((n) => n.id))).toEqual(
      new Set(['n-aaa', 'n-bbb', 'n-ccc']),
    );
  });

  it('token filter is case-insensitive', () => {
    const result = filterTraceData(stripped, undefined, 'eth');
    expect(result.edges.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
  });

  it('combined address + token filter intersects', () => {
    // address=0xAAA limits edges to e1, e3. token=USDT requires USDT only.
    // intersection is empty since e1, e3 are ETH.
    const result = filterTraceData(stripped, '0xAAA', 'USDT');
    expect(result.edges).toEqual([]);
    // No surviving edges → only the matched node 0xAAA remains.
    expect(result.nodes.map((n) => n.id)).toEqual(['n-aaa']);
  });

  it('combined address + token where intersection has results', () => {
    const result = filterTraceData(stripped, '0xBBB', 'ETH');
    // 0xBBB edges: e1 (aaa↔bbb), e2 (bbb↔ccc). ETH only: e1.
    expect(result.edges.map((e) => e.id)).toEqual(['e1']);
    expect(new Set(result.nodes.map((n) => n.id))).toEqual(
      new Set(['n-aaa', 'n-bbb']),
    );
  });

  it('returns empty result when nothing matches address', () => {
    const result = filterTraceData(stripped, '0xZZZNOMATCH');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.edgeBundles).toEqual([]);
  });

  it('returns empty result when nothing matches token', () => {
    const result = filterTraceData(stripped, undefined, 'NOPE');
    expect(result.edges).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.groups).toEqual([]);
    expect(result.edgeBundles).toEqual([]);
  });

  it('prunes groups whose nodes no longer survive', () => {
    // 0xCCC matches → kept node is n-ccc. group g1 contains n-aaa, n-bbb.
    // After address filter (0xCCC), edges keep both n-aaa↔ccc & n-bbb↔ccc, so
    // the surviving nodes include n-aaa and n-bbb (e1, e2 neighbors).
    // Verify groups remain when their nodes survive:
    const ccc = filterTraceData(stripped, '0xCCC');
    expect(ccc.nodes.map((n) => n.id).sort()).toEqual(
      ['n-aaa', 'n-bbb', 'n-ccc'].sort(),
    );
    expect(ccc.groups).toHaveLength(1);
    expect(new Set(ccc.groups[0].nodeIds)).toEqual(new Set(['n-aaa', 'n-bbb']));
  });

  it('drops groups when zero of their nodeIds survive', () => {
    // Filter to 0xDDD: only n-ddd survives. g1 contains n-aaa, n-bbb → empty.
    const result = filterTraceData(stripped, '0xDDD');
    expect(result.groups).toEqual([]);
  });

  it('prunes edge bundles to surviving edge ids', () => {
    // bundle b1 has edgeIds: [e1, e3]. After token=USDT, neither survives.
    const result = filterTraceData(stripped, undefined, 'USDT');
    expect(result.edgeBundles).toEqual([]);
  });

  it('keeps edge bundle with only surviving edges', () => {
    // After token=ETH filter, e1 and e3 survive. bundle b1 ⊆ {e1, e3} → kept.
    const result = filterTraceData(stripped, undefined, 'ETH');
    expect(result.edgeBundles).toHaveLength(1);
    expect(result.edgeBundles[0].edgeIds.sort()).toEqual(['e1', 'e3']);
  });
});
