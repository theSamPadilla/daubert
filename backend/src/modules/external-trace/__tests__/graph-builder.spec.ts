// backend/src/modules/external-trace/__tests__/graph-builder.spec.ts
import { buildGraph } from '../graph-builder';
import { TransactionResult } from '../../blockchain/blockchain.service';
import { UtxoContext } from '../../blockchain/types';

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

const BTC_TOKEN = { address: '', symbol: 'BTC', decimals: 8 };

const junctionUtxo = (overrides: Partial<UtxoContext> = {}): UtxoContext => ({
  inputs: [{ address: null, value: '10000000', prevTxid: 'prevtx', prevVout: 0 }],
  outputs: [
    { address: 'bc1qtraced', value: '50000000', index: 0 },
    { address: null, value: '9000000', index: 1 },
  ],
  fee: '1000',
  junction: true,
  ...overrides,
});

// Incoming junction row: from is unattributable ('') and `to` is the traced address.
const incomingJunctionTx = (overrides: Partial<TransactionResult> = {}): TransactionResult => ({
  id: 'btc-tx-id',
  from: '',
  to: 'bc1qtraced',
  txHash: 'txid1',
  chain: 'bitcoin',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '50000000',
  token: { ...BTC_TOKEN },
  blockNumber: 800000,
  notes: '',
  tags: [],
  crossTrace: false,
  utxo: junctionUtxo(),
  ...overrides,
});

// Outgoing / address-in-inputs junction row: from is the traced address, `to` is a
// counterparty that must NOT be drawn as a node.
const outgoingJunctionTx = (overrides: Partial<TransactionResult> = {}): TransactionResult => ({
  id: 'btc-tx-id-2',
  from: 'bc1qtraced',
  to: 'bc1qcounterparty',
  txHash: 'txid2',
  chain: 'bitcoin',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '50000000',
  token: { ...BTC_TOKEN },
  blockNumber: 800001,
  notes: '',
  tags: [],
  crossTrace: false,
  utxo: junctionUtxo({
    inputs: [{ address: 'bc1qtraced', value: '60000000', prevTxid: 'prevtx2', prevVout: 0 }],
    outputs: [
      { address: 'bc1qcounterparty', value: '50000000', index: 0 },
      { address: 'bc1qtraced', value: '9000000', index: 1, change: true },
    ],
  }),
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

  it('leaves kind and utxoSummary absent on ordinary (non-junction) nodes', () => {
    const { nodes } = buildGraph([tx()], '0xaaa');
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.kind).toBeUndefined();
      expect(node.utxoSummary).toBeUndefined();
    }
  });

  it('keeps a native SOL and an SPL transfer between the same pair as separate edges (mint-keyed)', () => {
    // Documents mint-keyed edge separation for Solana: buildGraph already
    // keys edges by `${from}->${to}->${token.address}`, so native SOL
    // (empty token address) and an SPL transfer (mint address) between the
    // same from/to never merge, even though from/to are identical.
    const { edges } = buildGraph(
      [
        tx({
          chain: 'solana',
          from: 'SoLCp1Addr111111111111111111111111',
          to: 'SoLRootAddr1111111111111111111111',
          txHash: 'sig1',
          amount: '1000000000',
          token: { address: '', symbol: 'SOL', decimals: 9 },
          solana: { transferIndex: 0, feePayer: 'SoLCp1Addr111111111111111111111111', kind: 'native' },
        }),
        tx({
          chain: 'solana',
          from: 'SoLCp1Addr111111111111111111111111',
          to: 'SoLRootAddr1111111111111111111111',
          txHash: 'sig1',
          amount: '500000',
          token: { address: 'SPLMintAddr11111111111111111111111', symbol: 'USDC', decimals: 6 },
          solana: { transferIndex: 1, feePayer: 'SoLCp1Addr111111111111111111111111', kind: 'spl' },
        }),
      ],
      'SoLRootAddr1111111111111111111111',
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => e.token.symbol).sort()).toEqual(['SOL', 'USDC']);
  });
});

describe('buildGraph — BTC junction rows', () => {
  it('creates a junction node for an incoming row, with edge junction -> address', () => {
    const { nodes, edges } = buildGraph([incomingJunctionTx()], 'bc1qtraced');

    const junction = nodes.find((n) => n.id === 'txid1');
    expect(junction).toBeDefined();
    expect(junction?.kind).toBe('txJunction');
    expect(junction?.label).toBeNull();
    expect(junction?.isRoot).toBe(false);
    expect(junction?.utxoSummary).toEqual({ inputs: 1, outputs: 2, fee: '1000' });

    const tracedNode = nodes.find((n) => n.id === 'bc1qtraced');
    expect(tracedNode).toBeDefined();
    expect(tracedNode?.isRoot).toBe(true);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: 'txid1',
      to: 'bc1qtraced',
      amount: '0.5',
      txCount: 1,
    });
  });

  it('creates an address -> junction edge for an outgoing row, and omits the counterparty node', () => {
    const { nodes, edges } = buildGraph([outgoingJunctionTx()], 'bc1qtraced');

    const junction = nodes.find((n) => n.id === 'txid2');
    expect(junction).toBeDefined();
    expect(junction?.kind).toBe('txJunction');
    expect(junction?.utxoSummary).toEqual({ inputs: 1, outputs: 2, fee: '1000' });

    // The counterparty on the far side of the junction is deliberately not drawn.
    expect(nodes.find((n) => n.id === 'bc1qcounterparty')).toBeUndefined();

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: 'bc1qtraced',
      to: 'txid2',
      amount: '0.5',
      txCount: 1,
    });
  });

  it('formats satoshi amounts at 8 decimals (50000000 sats -> "0.5")', () => {
    const { edges } = buildGraph([incomingJunctionTx({ amount: '50000000' })], 'bc1qtraced');
    expect(edges[0].amount).toBe('0.5');
  });

  it('formats sub-0.0001 satoshi amounts by significant digits, not decimal places (2607 sats -> "0.00002607")', () => {
    const { edges } = buildGraph([incomingJunctionTx({ amount: '2607' })], 'bc1qtraced');
    expect(edges[0].amount).toBe('0.00002607');
  });

  it('aggregates two rows sharing one txid onto a single junction node and edge', () => {
    const sharedUtxo = junctionUtxo({
      inputs: [{ address: 'bc1qtraced', value: '110000000', prevTxid: 'prevtx3', prevVout: 0 }],
      outputs: [
        { address: 'bc1qcp1', value: '50000000', index: 0 },
        { address: 'bc1qcp2', value: '50000000', index: 1 },
      ],
    });
    const row1 = outgoingJunctionTx({
      txHash: 'txid3',
      to: 'bc1qcp1',
      amount: '50000000',
      utxo: sharedUtxo,
    });
    const row2 = outgoingJunctionTx({
      txHash: 'txid3',
      to: 'bc1qcp2',
      amount: '50000000',
      utxo: sharedUtxo,
    });

    const { nodes, edges } = buildGraph([row1, row2], 'bc1qtraced');

    const junctionNodes = nodes.filter((n) => n.id === 'txid3');
    expect(junctionNodes).toHaveLength(1);
    expect(junctionNodes[0].utxoSummary).toEqual({ inputs: 1, outputs: 2, fee: '1000' });

    expect(nodes.find((n) => n.id === 'bc1qcp1')).toBeUndefined();
    expect(nodes.find((n) => n.id === 'bc1qcp2')).toBeUndefined();

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from: 'bc1qtraced',
      to: 'txid3',
      amount: '1',
      txCount: 2,
    });
  });
});
