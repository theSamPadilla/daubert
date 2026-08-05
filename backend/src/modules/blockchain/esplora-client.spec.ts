import { EsploraClient } from './esplora-client';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';

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

describe('EsploraClient', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('success path', () => {
    it('returns the parsed body and calls the primary host', async () => {
      const tx = { txid: 'abc', fee: 100 };
      fetchSpy.mockResolvedValueOnce(mockResponse(200, tx));

      const client = new EsploraClient();
      const result = await client.tx('abc');

      expect(result).toEqual(tx);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith('https://mempool.space/api/tx/abc');
    });
  });

  describe('failover', () => {
    it('retries on host[1] after a 429 from host[0] and returns its result', async () => {
      const tx = { txid: 'abc', fee: 100 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, {}))
        .mockResolvedValueOnce(mockResponse(200, tx));

      const client = new EsploraClient();
      const result = await client.tx('abc');

      expect(result).toEqual(tx);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        'https://mempool.space/api/tx/abc',
      );
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://blockstream.info/api/tx/abc',
      );
    });

    it('retries on host[1] after a 500 from host[0] and returns its result', async () => {
      const tx = { txid: 'abc', fee: 100 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(500, {}))
        .mockResolvedValueOnce(mockResponse(200, tx));

      const client = new EsploraClient();
      const result = await client.tx('abc');

      expect(result).toEqual(tx);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://blockstream.info/api/tx/abc',
      );
    });

    it('retries on host[1] after a network error from host[0] and returns its result', async () => {
      const tx = { txid: 'abc', fee: 100 };
      fetchSpy
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(mockResponse(200, tx));

      const client = new EsploraClient();
      const result = await client.tx('abc');

      expect(result).toEqual(tx);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://blockstream.info/api/tx/abc',
      );
    });
  });

  describe('non-failover 4xx', () => {
    it('does not fail over on 404, calling fetch once and throwing with the status', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(404, {}));

      const client = new EsploraClient();

      await expect(client.tx('missing')).rejects.toThrow(/404/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('both hosts fail', () => {
    it('throws an Esplora API error when both hosts fail', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse(500, {}))
        .mockResolvedValueOnce(mockResponse(500, {}));

      const client = new EsploraClient();

      await expect(client.tx('abc')).rejects.toThrow(/Esplora API error/);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('rate limiter', () => {
    it('calls acquire once per HTTP attempt (twice on a failover)', async () => {
      const tx = { txid: 'abc', fee: 100 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, {}))
        .mockResolvedValueOnce(mockResponse(200, tx));

      const rateLimiter = stubRateLimiter();
      const client = new EsploraClient(undefined, rateLimiter);
      await client.tx('abc');

      expect(rateLimiter.acquire).toHaveBeenCalledTimes(2);
    });

    it('calls acquire once on a plain success', async () => {
      const tx = { txid: 'abc', fee: 100 };
      fetchSpy.mockResolvedValueOnce(mockResponse(200, tx));

      const rateLimiter = stubRateLimiter();
      const client = new EsploraClient(undefined, rateLimiter);
      await client.tx('abc');

      expect(rateLimiter.acquire).toHaveBeenCalledTimes(1);
    });
  });

  describe('caching', () => {
    it('does not hit fetch on a second identical call (addressStats)', async () => {
      const stats = {
        address: 'addr1',
        chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
      };
      fetchSpy.mockResolvedValueOnce(mockResponse(200, stats));

      const cache = new ResponseCache();
      const client = new EsploraClient(undefined, undefined, cache);

      const first = await client.addressStats('addr1');
      const second = await client.addressStats('addr1');

      expect(first).toEqual(stats);
      expect(second).toEqual(stats);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not cache mempoolTxs responses (two calls -> two fetches)', async () => {
      const txs = [{ txid: 'abc' }];
      fetchSpy
        .mockResolvedValueOnce(mockResponse(200, txs))
        .mockResolvedValueOnce(mockResponse(200, txs));

      const cache = new ResponseCache();
      const client = new EsploraClient(undefined, undefined, cache);

      await client.mempoolTxs('addr1');
      await client.mempoolTxs('addr1');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
