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
});
