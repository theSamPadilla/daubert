import { mapFetchedTx, dedupeTxs, runSeed, shortAddress, SeedEmptyError } from './useCaseSeed';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    fetchHistory: jest.fn(),
    createInvestigation: jest.fn(),
    createTrace: jest.fn(),
    importTransactions: jest.fn(),
  },
}));
const api = apiClient as jest.Mocked<typeof apiClient>;

// Real-shaped fetch-history item — mirrors backend `TransactionResult`
// (backend/src/modules/blockchain/blockchain.service.ts:7-24). Note `token`
// is an OBJECT here, whereas ImportTransactionItem.token must be a plain string.
const FETCHED_TX = {
  id: 'tx-abc',
  from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  txHash: '0xdeadbeef',
  chain: 'ethereum',
  timestamp: '2022-01-24T19:08:00.000Z',
  amount: '1500000000000000000',
  token: { address: '0xToken', symbol: 'USDC', decimals: 6 },
  blockNumber: 14000000,
  notes: '',
  tags: [],
  crossTrace: false,
};

describe('mapFetchedTx', () => {
  it('maps a fetched tx to an ImportTransactionItem with ISO timestamp', () => {
    const item = mapFetchedTx(FETCHED_TX as never, 'ethereum');
    expect(item.txHash).toBe('0xdeadbeef');
    expect(item.from).toBe(FETCHED_TX.from);
    expect(item.to).toBe(FETCHED_TX.to);
    expect(item.amount).toBe('1500000000000000000');
    expect(item.chain).toBe('ethereum');
    expect(item.blockNumber).toBe(14000000);
    expect(new Date(item.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('collapses the token object to its symbol string (not an object)', () => {
    const item = mapFetchedTx(FETCHED_TX as never, 'ethereum');
    expect(typeof item.token).toBe('string');
    expect(item.token).toBe('USDC');
  });

  it('passes a plain-string token straight through', () => {
    const item = mapFetchedTx({ ...FETCHED_TX, token: 'ETH' } as never, 'ethereum');
    expect(item.token).toBe('ETH');
  });

  it('normalizes a unix-seconds timestamp to an ISO string', () => {
    const item = mapFetchedTx({ ...FETCHED_TX, timestamp: '1642503600' } as never, 'ethereum');
    expect(new Date(item.timestamp).toString()).not.toBe('Invalid Date');
    // ISO strings contain a "T" separator
    expect(item.timestamp).toContain('T');
  });

  it('carries utxo through untouched (Bitcoin junction rows)', () => {
    const utxo = {
      inputs: [{ address: null, value: '1', coinbase: true }],
      outputs: [{ address: 'bc1qrecipient', value: '1', index: 0 }],
      fee: '0',
      junction: true,
    };
    const item = mapFetchedTx({ ...FETCHED_TX, chain: 'bitcoin', utxo } as never, 'bitcoin');
    expect(item.utxo).toBe(utxo);
  });

  it('omits utxo when the fetched row carries none (non-BTC rows)', () => {
    const item = mapFetchedTx(FETCHED_TX as never, 'ethereum');
    expect(item.utxo).toBeUndefined();
  });

  it('carries solana through untouched (per-transfer provenance)', () => {
    const solana = {
      transferIndex: 0,
      feePayer: 'FeePayerSoLanaAddressXXXXXXXXXXXXXXXXXXXXX',
      kind: 'native' as const,
    };
    const item = mapFetchedTx({ ...FETCHED_TX, chain: 'solana', solana } as never, 'solana');
    expect(item.solana).toBe(solana);
  });

  it('omits solana when the fetched row carries none (non-Solana rows)', () => {
    const item = mapFetchedTx(FETCHED_TX as never, 'ethereum');
    expect(item.solana).toBeUndefined();
  });

  it('carries tokenMeta through when the fetched token has address + decimals', () => {
    const item = mapFetchedTx(FETCHED_TX as never, 'ethereum');
    expect(item.tokenMeta).toEqual({ address: '0xToken', decimals: 6 });
  });

  it('omits tokenMeta when the fetched token is a bare string', () => {
    const item = mapFetchedTx({ ...FETCHED_TX, token: 'ETH' } as never, 'ethereum');
    expect(item.tokenMeta).toBeUndefined();
  });

  it('omits tokenMeta when the fetched token object lacks address/decimals', () => {
    const item = mapFetchedTx({ ...FETCHED_TX, token: { symbol: 'ETH' } } as never, 'ethereum');
    expect(item.tokenMeta).toBeUndefined();
  });
});

describe('dedupeTxs', () => {
  it('drops duplicate txHash-from-to triples', () => {
    const a = { txHash: '0x1', from: '0xa', to: '0xb' } as never;
    expect(dedupeTxs([a, { ...(a as object) } as never])).toHaveLength(1);
  });

  it('keeps txs that differ in from/to even with the same hash', () => {
    const a = { txHash: '0x1', from: '0xa', to: '0xb' } as never;
    const b = { txHash: '0x1', from: '0xb', to: '0xc' } as never;
    expect(dedupeTxs([a, b])).toHaveLength(2);
  });

  it('keys BTC junction legs on txid:in:<legIndex> / txid:<vout>, not from/to', () => {
    // Two output legs of the same junction tx that happen to pay the same
    // address (e.g. two outputs to a reused change address) are DIFFERENT
    // facts — the generic from/to/txHash triple would wrongly collapse them.
    const legA = {
      txHash: '0x1', from: '', to: '0xsame', chain: 'bitcoin',
      utxo: { inputs: [], outputs: [], fee: '0', legType: 'output', vout: 0 },
    } as never;
    const legB = {
      txHash: '0x1', from: '', to: '0xsame', chain: 'bitcoin',
      utxo: { inputs: [], outputs: [], fee: '0', legType: 'output', vout: 1 },
    } as never;
    expect(dedupeTxs([legA, legB])).toHaveLength(2);
  });

  it('drops a re-fetched duplicate of the same junction leg', () => {
    const leg = {
      txHash: '0x1', from: '', to: '0xa', chain: 'bitcoin',
      utxo: { inputs: [], outputs: [], fee: '0', legType: 'input', legIndex: 2 },
    } as never;
    expect(dedupeTxs([leg, { ...(leg as object) } as never])).toHaveLength(1);
  });
});

describe('shortAddress', () => {
  it('truncates a long address to head…tail form', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
  });

  it('leaves a short address untouched', () => {
    expect(shortAddress('0xabc')).toBe('0xabc');
  });
});

describe('runSeed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is fetch-first: creates nothing when no address returns transactions', async () => {
    api.fetchHistory.mockResolvedValue({ transactions: [], chain: 'ethereum', address: '0xa' });
    await expect(runSeed('case-1', ['0xa'], 'ethereum')).rejects.toThrow(SeedEmptyError);
    expect(api.createInvestigation).not.toHaveBeenCalled();
    expect(api.createTrace).not.toHaveBeenCalled();
    expect(api.importTransactions).not.toHaveBeenCalled();
  });

  it('continues past one failing address and imports the rest', async () => {
    api.fetchHistory
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ transactions: [FETCHED_TX], chain: 'ethereum', address: '0xb' });
    api.createInvestigation.mockResolvedValue({ id: 'inv-1', traces: [{ id: 'trace-1' }] } as never);
    api.importTransactions.mockResolvedValue({ added: { nodes: 2, edges: 1 } });
    const result = await runSeed('case-1', ['0xa', '0xb'], 'ethereum');
    expect(result.investigationId).toBe('inv-1');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].address).toBe('0xa');
    expect(api.importTransactions).toHaveBeenCalledTimes(1);
  });

  it('creates investigation with a trace, then imports, in order', async () => {
    api.fetchHistory.mockResolvedValue({ transactions: [FETCHED_TX], chain: 'ethereum', address: '0xa' });
    api.createInvestigation.mockResolvedValue({ id: 'inv-1', traces: [{ id: 'trace-1' }] } as never);
    api.importTransactions.mockResolvedValue({ added: { nodes: 2, edges: 1 } });
    const result = await runSeed('case-1', ['0xa'], 'ethereum');
    expect(result).toMatchObject({
      investigationId: 'inv-1',
      traceId: 'trace-1',
      nodeCount: 2,
      edgeCount: 1,
      txCount: 1,
    });
    expect(api.createInvestigation).toHaveBeenCalledWith('case-1', {
      name: 'Fund tracing',
      initialTraceName: shortAddress('0xa'),
    });
    expect(api.createTrace).not.toHaveBeenCalled();
  });

  it('reports phases in order via onPhase', async () => {
    api.fetchHistory.mockResolvedValue({ transactions: [FETCHED_TX], chain: 'ethereum', address: '0xa' });
    api.createInvestigation.mockResolvedValue({ id: 'inv-1', traces: [{ id: 'trace-1' }] } as never);
    api.importTransactions.mockResolvedValue({ added: { nodes: 2, edges: 1 } });
    const phases: string[] = [];
    await runSeed('case-1', ['0xa'], 'ethereum', (p) => phases.push(p));
    expect(phases).toEqual(['fetching', 'creating', 'importing', 'done']);
  });

  it('sends the import a plain-string token (not the fetched object)', async () => {
    api.fetchHistory.mockResolvedValue({ transactions: [FETCHED_TX], chain: 'ethereum', address: '0xa' });
    api.createInvestigation.mockResolvedValue({ id: 'inv-1', traces: [{ id: 'trace-1' }] } as never);
    api.importTransactions.mockResolvedValue({ added: { nodes: 2, edges: 1 } });
    await runSeed('case-1', ['0xa'], 'ethereum');
    const sentItems = api.importTransactions.mock.calls[0][1];
    expect(typeof sentItems[0].token).toBe('string');
    expect(sentItems[0].token).toBe('USDC');
  });

  it('fetches bitcoin with maxTotal (its provider ignores offset, paginating on its own cursor)', async () => {
    api.fetchHistory.mockResolvedValue({ transactions: [], chain: 'bitcoin', address: 'bc1qa' });
    await expect(runSeed('case-1', ['bc1qa'], 'bitcoin')).rejects.toThrow(SeedEmptyError);
    expect(api.fetchHistory).toHaveBeenCalledWith(
      'bc1qa',
      'bitcoin',
      expect.objectContaining({ maxTotal: 100 }),
    );
    const opts = api.fetchHistory.mock.calls[0][2];
    expect(opts).not.toHaveProperty('offset');
  });

  it('fetches non-bitcoin chains with offset (unchanged pre-existing behavior)', async () => {
    api.fetchHistory.mockResolvedValue({ transactions: [], chain: 'ethereum', address: '0xa' });
    await expect(runSeed('case-1', ['0xa'], 'ethereum')).rejects.toThrow(SeedEmptyError);
    expect(api.fetchHistory).toHaveBeenCalledWith(
      '0xa',
      'ethereum',
      expect.objectContaining({ offset: 100 }),
    );
    const opts = api.fetchHistory.mock.calls[0][2];
    expect(opts).not.toHaveProperty('maxTotal');
  });

  it('fetches solana with maxTotal (cursor-paginated, like bitcoin)', async () => {
    api.fetchHistory.mockResolvedValue({ transactions: [], chain: 'solana', address: 'SoLwallet' });
    await expect(runSeed('case-1', ['SoLwallet'], 'solana')).rejects.toThrow(SeedEmptyError);
    expect(api.fetchHistory).toHaveBeenCalledWith(
      'SoLwallet',
      'solana',
      expect.objectContaining({ maxTotal: 100 }),
    );
    const opts = api.fetchHistory.mock.calls[0][2];
    expect(opts).not.toHaveProperty('offset');
  });
});
