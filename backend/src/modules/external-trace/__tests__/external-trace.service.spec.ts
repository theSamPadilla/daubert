import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExternalTraceService } from '../external-trace.service';
import { BlockchainService } from '../../blockchain/blockchain.service';
import { LabeledEntitiesService } from '../../labeled-entities/labeled-entities.service';

const tx = (from: string, to: string, hash = '0xh') => ({
  id: 'i',
  from,
  to,
  txHash: hash,
  chain: 'ethereum',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '1000000000000000000',
  token: { address: '0x', symbol: 'ETH', decimals: 18 },
  blockNumber: 1,
  notes: '',
  tags: [],
  crossTrace: false,
});

// Deterministic, regex-valid bech32 addresses (BTC_BECH32_ADDRESS_RE only
// allows [02-9ac-hj-np-z] after the `bc1` prefix -- no '1', 'b', 'i', 'o').
const ROOT = 'bc1qhjp7r5ht8cmjtgkjxzcp';
const CP1 = 'bc1qgyjamkcav5rjxhlzcrcy';
const CP2 = 'bc1qf6t74fa4dlyaua9rc936';
const CP3 = 'bc1q929eh5utrlsq6h4syljl';
const CP4 = 'bc1q8pcuzyfvj7hjf3g4tjv3';
const CP5 = 'bc1q7vp3zh2sd83fe6nuu38w';

const btcTx = (
  from: string,
  to: string,
  vout: number,
  opts: { hash?: string; junction?: boolean } = {},
) => ({
  id: 'i',
  from,
  to,
  txHash: opts.hash ?? 'btctx',
  chain: 'bitcoin',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '100000',
  token: { address: '', symbol: 'BTC', decimals: 8 },
  blockNumber: 1,
  notes: '',
  tags: [],
  crossTrace: false,
  utxo: {
    inputs: [],
    outputs: [],
    fee: '500',
    vout,
    junction: opts.junction ?? false,
  },
});

// Deterministic, regex-valid Solana base58 addresses (32-44 chars, no
// 0/O/I/l) that don't collide with the Tron shape (T + 33 base58 chars).
const SOL_ROOT = 'SoLRootAddr1111111111111111111111';
const SOL_CP1 = 'SoLCp1Addr111111111111111111111111';
const SPL_MINT = 'SPLMintAddr11111111111111111111111';

const solTx = (
  from: string,
  to: string,
  transferIndex: number,
  opts: { hash?: string; spam?: boolean; kind?: 'native' | 'spl'; mint?: string } = {},
) => ({
  id: 'i',
  from,
  to,
  txHash: opts.hash ?? 'soltx',
  chain: 'solana',
  timestamp: '2026-05-01T00:00:00.000Z',
  amount: '1000000000',
  token: opts.mint
    ? { address: opts.mint, symbol: 'USDC', decimals: 6 }
    : { address: '', symbol: 'SOL', decimals: 9 },
  blockNumber: 1,
  notes: '',
  tags: [],
  crossTrace: false,
  solana: {
    transferIndex,
    feePayer: from,
    kind: opts.kind ?? (opts.mint ? 'spl' : 'native'),
    ...(opts.spam !== undefined ? { spam: opts.spam } : {}),
  },
});

describe('ExternalTraceService', () => {
  let service: ExternalTraceService;
  let blockchain: { fetchHistory: jest.Mock };
  let labels: { lookupByAddresses: jest.Mock };

  beforeEach(async () => {
    blockchain = { fetchHistory: jest.fn() };
    labels = { lookupByAddresses: jest.fn().mockResolvedValue(new Map()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExternalTraceService,
        { provide: BlockchainService, useValue: blockchain },
        { provide: LabeledEntitiesService, useValue: labels },
      ],
    }).compile();

    service = moduleRef.get(ExternalTraceService);
  });

  it('hops=1: fetches root only', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [tx('0xaaa000000000000000000000000000000000000a', '0xbbb000000000000000000000000000000000000b')],
      chain: 'ethereum',
      address: '0xaaa000000000000000000000000000000000000a',
    });

    const result = await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 1);
    expect(blockchain.fetchHistory).toHaveBeenCalledTimes(1);
    expect(result.root).toBe('0xaaa000000000000000000000000000000000000a');
    expect(result.nodes).toHaveLength(2);
    expect(result.hops).toBe(1);
  });

  it('hops=2: fetches root plus top counterparties', async () => {
    blockchain.fetchHistory
      .mockResolvedValueOnce({
        transactions: [
          tx('0xaaa000000000000000000000000000000000000a', '0xbbb000000000000000000000000000000000000b', '0xh1'),
          tx('0xaaa000000000000000000000000000000000000a', '0xccc000000000000000000000000000000000000c', '0xh2'),
        ],
        chain: 'ethereum',
        address: '0xaaa000000000000000000000000000000000000a',
      })
      .mockResolvedValue({ transactions: [], chain: 'ethereum', address: '?' });

    const result = await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 2);
    expect(blockchain.fetchHistory.mock.calls.length).toBeGreaterThan(1);
    expect(result.hops).toBe(2);
  });

  it('attaches labels when found via the batch lookup', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [tx('0xaaa000000000000000000000000000000000000a', '0xbbb000000000000000000000000000000000000b')],
      chain: 'ethereum',
      address: '0xaaa000000000000000000000000000000000000a',
    });
    labels.lookupByAddresses.mockResolvedValue(
      new Map([['0xbbb000000000000000000000000000000000000b', [{ name: 'Tornado Cash', category: 'mixer' }]]]),
    );

    const result = await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 1);
    const bbb = result.nodes.find((n) => n.address === '0xbbb000000000000000000000000000000000000b');
    expect(bbb?.label).toEqual({ name: 'Tornado Cash', category: 'mixer' });
    // One round-trip total, not one per node.
    expect(labels.lookupByAddresses).toHaveBeenCalledTimes(1);
  });

  it('serves a second identical request from cache (no extra fetchHistory call)', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [tx('0xaaa000000000000000000000000000000000000a', '0xbbb000000000000000000000000000000000000b')],
      chain: 'ethereum',
      address: '0xaaa000000000000000000000000000000000000a',
    });
    await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 1);
    await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 1);
    expect(blockchain.fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('rejects EVM address on tron chain', async () => {
    await expect(service.trace('0xaaa', 'tron' as any, 1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lowercases EVM addresses, preserves Tron', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [],
      chain: 'ethereum',
      address: '0xaaa',
    });
    await service.trace('0xABC0000000000000000000000000000000000DEF', 'ethereum', 1);
    expect(blockchain.fetchHistory).toHaveBeenCalledWith(
      '0xabc0000000000000000000000000000000000def',
      'ethereum',
      expect.any(Object),
    );
  });

  it('expires cached entries after CACHE_TTL_MS and re-fetches', async () => {
    jest.useFakeTimers();
    try {
      blockchain.fetchHistory.mockResolvedValue({
        transactions: [tx('0xaaa000000000000000000000000000000000000a', '0xbbb000000000000000000000000000000000000b')],
        chain: 'ethereum',
        address: '0xaaa000000000000000000000000000000000000a',
      });

      await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 1);
      expect(blockchain.fetchHistory).toHaveBeenCalledTimes(1);

      // Advance past 60s (CACHE_TTL_MS = 60_000)
      jest.setSystemTime(Date.now() + 61_000);

      await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 1);
      expect(blockchain.fetchHistory).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('evicts oldest cache entry when CACHE_MAX_ENTRIES is reached', async () => {
    blockchain.fetchHistory.mockResolvedValue({
      transactions: [],
      chain: 'ethereum',
      address: 'x',
    });

    // Fill cache with 201 unique addresses (CACHE_MAX_ENTRIES = 200).
    // The 201st insertion triggers eviction of the first entry.
    for (let i = 0; i < 201; i++) {
      const addr = `0x${i.toString(16).padStart(40, '0')}`;
      await service.trace(addr, 'ethereum', 1);
    }

    // Re-trace the very first address — eviction should have removed it,
    // so fetchHistory must be called again (cache miss).
    const firstAddr = `0x${(0).toString(16).padStart(40, '0')}`;
    const callsBefore = blockchain.fetchHistory.mock.calls.length;
    await service.trace(firstAddr, 'ethereum', 1);
    expect(blockchain.fetchHistory.mock.calls.length).toBe(callsBefore + 1);
  });

  describe('bitcoin', () => {
    it('drops a self-send/change row (from === to) from the trimmed window', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [btcTx(ROOT, ROOT, 0)],
        chain: 'bitcoin',
        address: ROOT,
      });

      const result = await service.trace(ROOT, 'bitcoin', 1);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('retains both outputs of one txid to two different counterparties (edgeIdentityKey dedup)', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [
          btcTx(ROOT, CP1, 0, { hash: 'tx1' }),
          btcTx(ROOT, CP2, 1, { hash: 'tx1' }),
        ],
        chain: 'bitcoin',
        address: ROOT,
      });

      const result = await service.trace(ROOT, 'bitcoin', 1);
      expect(result.edges).toHaveLength(2);
      const tos = result.edges.map((e) => e.to).sort();
      expect(tos).toEqual([CP1, CP2].sort());
    });

    it('retains an incoming junction row as incoming, occupying a slot ahead of a lower-ranked real counterparty', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [
          btcTx('', ROOT, 0, { hash: 'junctx', junction: true }), // incoming junction row
          btcTx(CP1, ROOT, 0, { hash: 'h1' }),
          btcTx(CP2, ROOT, 0, { hash: 'h2' }),
          btcTx(CP3, ROOT, 0, { hash: 'h3' }),
          btcTx(CP4, ROOT, 0, { hash: 'h4' }),
          btcTx(CP5, ROOT, 0, { hash: 'h5' }),
        ],
        chain: 'bitcoin',
        address: ROOT,
      });

      const result = await service.trace(ROOT, 'bitcoin', 1);

      // PER_DIRECTION_LIMIT is 5. The junction row fills one incoming slot
      // (it is rendered as a junction node with an edge from the junction to
      // ROOT), leaving room for only 4 of the 5 real counterparties -- proof
      // the junction row was retained/bucketed as incoming rather than
      // discarded outright.
      expect(result.edges).toHaveLength(5);
      const froms = result.edges.map((e) => e.from).sort();
      expect(froms).toEqual([CP1, CP2, CP3, CP4, 'junctx'].sort());
      expect(froms).not.toContain(CP5);
    });

    it('never fetches an incoming junction row\'s txid at hop 2', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [btcTx('', ROOT, 0, { hash: 'junctx', junction: true })],
        chain: 'bitcoin',
        address: ROOT,
      });

      await service.trace(ROOT, 'bitcoin', 2);

      // No counterparty is ever ranked from this row, so no second fetch happens.
      expect(blockchain.fetchHistory).toHaveBeenCalledTimes(1);
    });

    it('never contributes an outgoing junction row\'s counterparty to hop-2 ranking', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [btcTx(ROOT, CP1, 0, { hash: 'outjunc', junction: true })],
        chain: 'bitcoin',
        address: ROOT,
      });

      await service.trace(ROOT, 'bitcoin', 2);

      // This row has `from: ROOT` (non-empty) -- a naive `!tx.from` check
      // alone would miss it. Only `utxo.junction` reliably flags this
      // shape. If it leaked through, CP1 would be fetched a second time.
      expect(blockchain.fetchHistory).toHaveBeenCalledTimes(1);
      expect(blockchain.fetchHistory).not.toHaveBeenCalledWith(
        CP1,
        'bitcoin',
        expect.anything(),
      );
    });

    it('forwards maxTotal alongside offset on the bitcoin fetch window', async () => {
      blockchain.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'bitcoin',
        address: ROOT,
      });

      await service.trace(ROOT, 'bitcoin', 1);

      expect(blockchain.fetchHistory).toHaveBeenCalledWith(ROOT, 'bitcoin', {
        offset: 40,
        maxTotal: 40,
      });
    });

    it('EVM fetch window omits maxTotal (regression guard for the bitcoin-only conditional)', async () => {
      blockchain.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'ethereum',
        address: '0xaaa000000000000000000000000000000000000a',
      });

      await service.trace('0xaaa000000000000000000000000000000000000a', 'ethereum', 1);

      expect(blockchain.fetchHistory).toHaveBeenCalledWith(
        '0xaaa000000000000000000000000000000000000a',
        'ethereum',
        { offset: 40 },
      );
    });
  });

  describe('solana', () => {
    it('forwards maxTotal alongside offset on the solana fetch window (cursor-paginated)', async () => {
      blockchain.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'solana',
        address: SOL_ROOT,
      });

      await service.trace(SOL_ROOT, 'solana', 1);

      expect(blockchain.fetchHistory).toHaveBeenCalledWith(SOL_ROOT, 'solana', {
        offset: 40,
        maxTotal: 40,
      });
    });

    it('drops a row flagged solana.spam === true from the trimmed window', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [solTx(SOL_CP1, SOL_ROOT, 0, { spam: true })],
        chain: 'solana',
        address: SOL_ROOT,
      });

      const result = await service.trace(SOL_ROOT, 'solana', 1);
      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('keeps a row with solana.spam === false', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [solTx(SOL_CP1, SOL_ROOT, 0, { spam: false })],
        chain: 'solana',
        address: SOL_ROOT,
      });

      const result = await service.trace(SOL_ROOT, 'solana', 1);
      expect(result.edges).toHaveLength(1);
    });

    it('retains two rows sharing one signature with different transferIndex as two edges (edgeIdentityKey dedup)', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [
          solTx(SOL_CP1, SOL_ROOT, 0, { hash: 'sig1' }),
          solTx(SOL_CP1, SOL_ROOT, 1, { hash: 'sig1', mint: SPL_MINT }),
        ],
        chain: 'solana',
        address: SOL_ROOT,
      });

      const result = await service.trace(SOL_ROOT, 'solana', 1);
      expect(result.edges).toHaveLength(2);
    });

    it('collapses two rows with identical txHash and transferIndex to one edge', async () => {
      blockchain.fetchHistory.mockResolvedValueOnce({
        transactions: [
          solTx(SOL_CP1, SOL_ROOT, 0, { hash: 'sig1' }),
          solTx(SOL_CP1, SOL_ROOT, 0, { hash: 'sig1' }),
        ],
        chain: 'solana',
        address: SOL_ROOT,
      });

      const result = await service.trace(SOL_ROOT, 'solana', 1);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].txCount).toBe(1);
    });
  });
});
