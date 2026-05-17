// backend/src/modules/external-trace/__tests__/graph-builder.spec.ts
import { buildGraph } from '../graph-builder';
import { TransactionResult } from '../../blockchain/blockchain.service';

const tx = (overrides: Partial<TransactionResult> = {}): TransactionResult => ({
  id: 'tx-id',
  from: '0xaaa',
  to: '0xbbb',
  txHash: '0xhash',
  chain: 'ethereum',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '1000000000000000000', // 1 ETH raw
  token: { address: '0x', symbol: 'ETH', decimals: 18 },
  blockNumber: 100,
  notes: '',
  tags: [],
  crossTrace: false,
  ...overrides,
});

describe('buildGraph', () => {
  it('returns a single edge and two nodes for one transaction', () => {
    const { nodes, edges } = buildGraph([tx()], '0xaaa');
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: '0xaaa',
      to: '0xbbb',
      txCount: 1,
      token: { symbol: 'ETH' },
      amount: '1',
    });
  });

  it('aggregates same-pair same-token transactions into one edge', () => {
    const { edges } = buildGraph(
      [tx(), tx({ txHash: '0xhash2', amount: '2000000000000000000' })],
      '0xaaa',
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].txCount).toBe(2);
    expect(edges[0].amount).toBe('3');
  });

  it('keeps same-pair different-token as separate edges', () => {
    const { edges } = buildGraph(
      [
        tx(),
        tx({
          txHash: '0xhash2',
          amount: '1000000',
          token: { address: '0xusdc', symbol: 'USDC', decimals: 6 },
        }),
      ],
      '0xaaa',
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.token.symbol).sort()).toEqual(['ETH', 'USDC']);
  });

  it('keeps two tokens with the same symbol but different addresses separate', () => {
    // Scam-token defense: two contracts both calling themselves USDC.
    const { edges } = buildGraph(
      [
        tx({
          amount: '1000000',
          token: { address: '0xrealusdc', symbol: 'USDC', decimals: 6 },
        }),
        tx({
          txHash: '0xhash2',
          amount: '5000000',
          token: { address: '0xfakeusdc', symbol: 'USDC', decimals: 6 },
        }),
      ],
      '0xaaa',
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.token.address).sort()).toEqual(['0xfakeusdc', '0xrealusdc']);
  });

  it('marks the root node with isRoot: true', () => {
    const { nodes } = buildGraph([tx()], '0xaaa');
    const root = nodes.find((n) => n.id === '0xaaa');
    expect(root?.isRoot).toBe(true);
  });

  it('formats sub-unit amounts to 4 decimal places without trailing zeros', () => {
    const { edges } = buildGraph(
      [tx({ amount: '1523400000000000000' })],
      '0xaaa',
    );
    expect(edges[0].amount).toBe('1.5234');
  });

  it('truncates to nodeCap when exceeded', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      tx({ to: `0x${i.toString(16).padStart(40, '0')}`, txHash: `0xh${i}` }),
    );
    const result = buildGraph(many, '0xaaa', { nodeCap: 100 });
    expect(result.nodes.length).toBeLessThanOrEqual(100);
    expect(result.truncated).toBe(true);
  });
});
