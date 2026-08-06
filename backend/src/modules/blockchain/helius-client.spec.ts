import { HeliusClient } from './helius-client';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';
import { HeliusProvider } from './helius.provider';
import { mapSolanaHistory } from './sol/map-solana-history';

/** Builds a minimal Response-like object for mocking global.fetch. */
function mockResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function stubRateLimiter(): RateLimiter {
  return {
    acquire: jest.fn().mockResolvedValue(undefined),
  } as unknown as RateLimiter;
}

const API_KEY = 'super-secret-helius-key';

describe('HeliusClient', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    // Skip real 600ms backoff waits in tests.
    jest.spyOn(HeliusClient.prototype as any, 'wait').mockResolvedValue(undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('addressTransactions', () => {
    it('carries api-key and limit params on the primary host', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, []));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      await client.addressTransactions('addr1');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.origin + calledUrl.pathname).toBe(
        'https://mainnet.helius-rpc.com/v0/addresses/addr1/transactions',
      );
      expect(calledUrl.searchParams.get('api-key')).toBe(API_KEY);
      expect(calledUrl.searchParams.get('limit')).toBe('100');
      expect(calledUrl.searchParams.has('before-signature')).toBe(false);
    });

    it('forwards beforeSignature as before-signature', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, []));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      await client.addressTransactions('addr1', { beforeSignature: 'sig123' });

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('before-signature')).toBe('sig123');
    });

    it('caps limit at 100', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, []));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      await client.addressTransactions('addr1', { limit: 500 });

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get('limit')).toBe('100');
    });

    it('caches identical calls (second call does not hit fetch)', async () => {
      const txs = [{ signature: 'abc' }];
      fetchSpy.mockResolvedValueOnce(mockResponse(200, txs));

      const cache = new ResponseCache();
      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter(), cache);

      const first = await client.addressTransactions('addr1');
      const second = await client.addressTransactions('addr1');

      expect(first).toEqual(txs);
      expect(second).toEqual(txs);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('429 handling', () => {
    it('retries once after a 429 and returns the retried result', async () => {
      const txs = [{ signature: 'abc' }];
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, {}))
        .mockResolvedValueOnce(mockResponse(200, txs));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      const result = await client.addressTransactions('addr1');

      expect(result).toEqual(txs);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws "Helius API error" after two consecutive 429s', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, {}))
        .mockResolvedValueOnce(mockResponse(429, {}));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());

      await expect(client.addressTransactions('addr1')).rejects.toThrow(
        /Helius API error: 429/,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does not retry on other non-OK statuses', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(404, {}));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());

      await expect(client.addressTransactions('addr1')).rejects.toThrow(
        /Helius API error: 404/,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('parseTransaction', () => {
    it('posts {transactions:[signature]} and returns the first element', async () => {
      const tx = { signature: 'sig-abc', timestamp: 1 };
      fetchSpy.mockResolvedValueOnce(mockResponse(200, [tx]));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      const result = await client.parseTransaction('sig-abc');

      expect(result).toEqual(tx);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, init] = fetchSpy.mock.calls[0];
      const calledUrl = new URL(url as string);
      expect(calledUrl.origin + calledUrl.pathname).toBe(
        'https://mainnet.helius-rpc.com/v0/transactions',
      );
      expect(calledUrl.searchParams.get('api-key')).toBe(API_KEY);
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        transactions: ['sig-abc'],
      });
    });

    it('throws when the response array is empty', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, []));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());

      await expect(client.parseTransaction('sig-missing')).rejects.toThrow();
    });
  });

  describe('getMintMetadata', () => {
    it('resolves symbol and decimals from token_info', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse(200, {
          jsonrpc: '2.0',
          result: [
            { id: 'MintAAA', token_info: { symbol: 'FOO', decimals: 6 } },
          ],
          id: '1',
        }),
      );

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      const result = await client.getMintMetadata(['MintAAA']);

      expect(result.get('MintAAA')).toEqual({
        mint: 'MintAAA',
        symbol: 'FOO',
        decimals: 6,
        resolved: true,
      });
    });

    it('falls back to a truncated symbol for unresolvable mints, marked unresolved', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse(200, { jsonrpc: '2.0', result: [null], id: '1' }),
      );

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      const result = await client.getMintMetadata(['UnknownMint123']);

      expect(result.get('UnknownMint123')).toEqual({
        mint: 'UnknownMint123',
        symbol: 'Unkn…',
        decimals: 0,
        resolved: false,
      });
    });

    it('resolves the correct mint to the correct metadata when getAssetBatch returns assets out of order', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse(200, {
          jsonrpc: '2.0',
          result: [
            { id: 'MintBBB', token_info: { symbol: 'BAR', decimals: 9 } },
            { id: 'MintAAA', token_info: { symbol: 'FOO', decimals: 6 } },
          ],
          id: '1',
        }),
      );

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      const result = await client.getMintMetadata(['MintAAA', 'MintBBB']);

      expect(result.get('MintAAA')).toEqual({
        mint: 'MintAAA',
        symbol: 'FOO',
        decimals: 6,
        resolved: true,
      });
      expect(result.get('MintBBB')).toEqual({
        mint: 'MintBBB',
        symbol: 'BAR',
        decimals: 9,
        resolved: true,
      });
    });

    it('chunks the uncached mint list at 1000 ids per getAssetBatch call', async () => {
      const ids = Array.from({ length: 1500 }, (_, i) => `Mint${i}`);
      fetchSpy
        .mockResolvedValueOnce(mockResponse(200, { jsonrpc: '2.0', result: [], id: '1' }))
        .mockResolvedValueOnce(mockResponse(200, { jsonrpc: '2.0', result: [], id: '1' }));

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      await client.getMintMetadata(ids);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      const secondBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
      expect(firstBody.params.ids).toHaveLength(1000);
      expect(secondBody.params.ids).toHaveLength(500);
      expect([...firstBody.params.ids, ...secondBody.params.ids].sort()).toEqual([...ids].sort());
    });

    it('F1 regression: flags unknown-mint end-to-end when DAS cannot resolve a mint (drives HeliusProvider.getAddressHistory into mapSolanaHistory)', async () => {
      const ADDRESS = 'SubjectWa11et11111111111111111111111111111';
      const MINT = 'UnresolvedMint1111111111111111111111111111';

      fetchSpy
        .mockResolvedValueOnce(
          mockResponse(200, [
            {
              signature: 'sig-unknown-mint',
              timestamp: 1_700_000_000,
              slot: 1,
              fee: 5000,
              feePayer: 'Airdr0pperWa11et',
              type: 'TRANSFER',
              source: 'UNKNOWN',
              nativeTransfers: [],
              tokenTransfers: [
                {
                  fromUserAccount: 'Airdr0pperWa11et',
                  toUserAccount: ADDRESS,
                  fromTokenAccount: 'FromAcct',
                  toTokenAccount: 'ToAcct',
                  mint: MINT,
                  tokenAmount: 1000,
                },
              ],
              transactionError: null,
            },
          ]),
        )
        .mockResolvedValueOnce(
          mockResponse(200, { jsonrpc: '2.0', result: [null], id: '1' }),
        );

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      const provider = new HeliusProvider(client);

      const { txs, mintMeta } = await provider.getAddressHistory(ADDRESS);
      const rows = mapSolanaHistory(ADDRESS, txs, mintMeta);

      expect(rows).toHaveLength(1);
      expect(rows[0].solana?.spamEvidence).toContain('unknown-mint');
    });

    it('skips fetch on a cache hit for a previously resolved mint', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse(200, {
          jsonrpc: '2.0',
          result: [{ id: 'MintAAA', token_info: { symbol: 'FOO', decimals: 6 } }],
          id: '1',
        }),
      );

      const cache = new ResponseCache();
      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter(), cache);

      const first = await client.getMintMetadata(['MintAAA']);
      const second = await client.getMintMetadata(['MintAAA']);

      expect(first.get('MintAAA')).toEqual({ mint: 'MintAAA', symbol: 'FOO', decimals: 6, resolved: true });
      expect(second.get('MintAAA')).toEqual({ mint: 'MintAAA', symbol: 'FOO', decimals: 6, resolved: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('only fetches uncached mints on a partial cache hit', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockResponse(200, {
            jsonrpc: '2.0',
            result: [{ id: 'MintAAA', token_info: { symbol: 'FOO', decimals: 6 } }],
            id: '1',
          }),
        )
        .mockResolvedValueOnce(
          mockResponse(200, {
            jsonrpc: '2.0',
            result: [{ id: 'MintBBB', token_info: { symbol: 'BAR', decimals: 9 } }],
            id: '1',
          }),
        );

      const cache = new ResponseCache();
      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter(), cache);

      await client.getMintMetadata(['MintAAA']);
      const second = await client.getMintMetadata(['MintAAA', 'MintBBB']);

      expect(second.get('MintAAA')).toEqual({ mint: 'MintAAA', symbol: 'FOO', decimals: 6, resolved: true });
      expect(second.get('MintBBB')).toEqual({ mint: 'MintBBB', symbol: 'BAR', decimals: 9, resolved: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const secondBody = JSON.parse(
        (fetchSpy.mock.calls[1][1] as RequestInit).body as string,
      );
      expect(secondBody.params.ids).toEqual(['MintBBB']);
    });
  });

  describe('getBalance', () => {
    it('returns lamports as a string', async () => {
      fetchSpy.mockResolvedValueOnce(
        mockResponse(200, {
          jsonrpc: '2.0',
          result: { context: { slot: 1 }, value: 123456789 },
          id: '1',
        }),
      );

      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter());
      const result = await client.getBalance('addr1');

      expect(result).toBe('123456789');
      expect(typeof result).toBe('string');
    });
  });

  describe('cache key hygiene', () => {
    it('never includes the api key in any cache key', async () => {
      fetchSpy.mockResolvedValue(
        mockResponse(200, {
          jsonrpc: '2.0',
          result: [{ id: 'MintAAA', token_info: { symbol: 'FOO', decimals: 6 } }],
          id: '1',
        }),
      );

      const cache = new ResponseCache();
      const buildKeySpy = jest.spyOn(cache, 'buildKey');
      const client = new HeliusClient(API_KEY, undefined, stubRateLimiter(), cache);

      fetchSpy.mockResolvedValueOnce(mockResponse(200, [{ signature: 'abc' }]));
      await client.addressTransactions('addr1');
      await client.getMintMetadata(['MintAAA']);

      for (const call of buildKeySpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(API_KEY);
      }
    });
  });
});
