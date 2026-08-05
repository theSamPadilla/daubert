import { BitcoinProvider } from './bitcoin.provider';
import { EsploraClient, EsploraTx } from './esplora-client';

/** Builds a stub EsploraClient with jest.fn() methods, typed as EsploraClient. */
function stubClient(): EsploraClient {
  return {
    addressStats: jest.fn(),
    confirmedTxs: jest.fn(),
    mempoolTxs: jest.fn(),
    tx: jest.fn(),
  } as unknown as EsploraClient;
}

function makeConfirmedTx(txid: string, blockTime = 2_000_000_000): EsploraTx {
  return {
    txid,
    fee: 100,
    vin: [],
    vout: [],
    status: { confirmed: true, block_time: blockTime },
  };
}

function makeMempoolTx(txid: string): EsploraTx {
  return {
    txid,
    fee: 100,
    vin: [],
    vout: [],
    status: { confirmed: false },
  };
}

describe('BitcoinProvider', () => {
  describe('getAddressHistory — cursor pagination', () => {
    it('walks the cursor across full pages and stops on a partial page', async () => {
      const client = stubClient();
      const page1 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p1-${i}`),
      );
      const page2 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p2-${i}`),
      );
      const page3 = Array.from({ length: 10 }, (_, i) =>
        makeConfirmedTx(`p3-${i}`),
      );
      (client.confirmedTxs as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce(page3);

      const provider = new BitcoinProvider(client);
      const result = await provider.getAddressHistory('addr', {
        includeMempool: false,
      });

      expect(client.confirmedTxs).toHaveBeenCalledTimes(3);
      expect(client.confirmedTxs).toHaveBeenNthCalledWith(1, 'addr', undefined);
      expect(client.confirmedTxs).toHaveBeenNthCalledWith(2, 'addr', 'p1-24');
      expect(client.confirmedTxs).toHaveBeenNthCalledWith(3, 'addr', 'p2-24');
      expect(result).toHaveLength(60);
    });
  });

  describe('getAddressHistory — maxTotal', () => {
    it('stops pagination once maxTotal is reached and caps the result', async () => {
      const client = stubClient();
      const page1 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p1-${i}`),
      );
      const page2 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p2-${i}`),
      );
      (client.confirmedTxs as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const provider = new BitcoinProvider(client);
      const result = await provider.getAddressHistory('addr', {
        maxTotal: 30,
        includeMempool: false,
      });

      expect(client.confirmedTxs).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(30);
    });
  });

  describe('getAddressHistory — date stop', () => {
    it('halts the loop once a full page is entirely older than startTimestamp, and filters those out of the final result', async () => {
      const client = stubClient();
      const startTimestamp = 1000;
      const page1 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p1-${i}`, 2000 - i),
      );
      const page2 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p2-${i}`, 500 - i),
      );
      (client.confirmedTxs as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const provider = new BitcoinProvider(client);
      const result = await provider.getAddressHistory('addr', {
        startTimestamp,
        includeMempool: false,
      });

      expect(client.confirmedTxs).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(25);
      expect(
        result.every((tx) => (tx.status.block_time ?? 0) >= startTimestamp),
      ).toBe(true);
    });
  });

  describe('getAddressHistory — date window (false-empty regression)', () => {
    it('keeps paging past newer-than-window pages and returns the page that falls inside [start,end], not []', async () => {
      const client = stubClient();
      const startTimestamp = 1000;
      const endTimestamp = 2000;
      // Pages 1 and 2 are full (25 rows) and entirely NEWER than endTimestamp
      // — a naive "stop once we've accumulated maxTotal raw rows" would halt
      // here and return [] after post-hoc filtering. Only page 3 (partial,
      // 10 rows) falls inside the window.
      const page1 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p1-${i}`, 5000 - i),
      );
      const page2 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p2-${i}`, 4000 - i),
      );
      const page3 = Array.from({ length: 10 }, (_, i) =>
        makeConfirmedTx(`p3-${i}`, 1500 - i),
      );
      (client.confirmedTxs as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce(page3);

      const provider = new BitcoinProvider(client);
      const result = await provider.getAddressHistory('addr', {
        startTimestamp,
        endTimestamp,
        includeMempool: false,
      });

      expect(client.confirmedTxs).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(10);
      expect(result.map((tx) => tx.txid).sort()).toEqual(
        page3.map((tx) => tx.txid).sort(),
      );
      expect(
        result.every((tx) => {
          const t = tx.status.block_time ?? 0;
          return t >= startTimestamp && t <= endTimestamp;
        }),
      ).toBe(true);
    });
  });

  describe('getAddressHistory — mempool handling', () => {
    it('prepends mempool txs before confirmed txs', async () => {
      const client = stubClient();
      const mempool = [makeMempoolTx('m1'), makeMempoolTx('m2')];
      const confirmedPage = [makeConfirmedTx('c1'), makeConfirmedTx('c2')];
      (client.mempoolTxs as jest.Mock).mockResolvedValue(mempool);
      (client.confirmedTxs as jest.Mock).mockResolvedValueOnce(confirmedPage);

      const provider = new BitcoinProvider(client);
      const result = await provider.getAddressHistory('addr');

      expect(result.map((tx) => tx.txid)).toEqual(['m1', 'm2', 'c1', 'c2']);
    });

    it('skips the mempool call entirely when includeMempool is false', async () => {
      const client = stubClient();
      (client.confirmedTxs as jest.Mock).mockResolvedValueOnce([
        makeConfirmedTx('c1'),
      ]);

      const provider = new BitcoinProvider(client);
      await provider.getAddressHistory('addr', { includeMempool: false });

      expect(client.mempoolTxs).not.toHaveBeenCalled();
    });
  });

  describe('getAddressHistory — partial tolerance', () => {
    it('returns accumulated txs when confirmedTxs rejects mid-loop, without throwing', async () => {
      const client = stubClient();
      const mempool = [makeMempoolTx('m1')];
      const page1 = Array.from({ length: 25 }, (_, i) =>
        makeConfirmedTx(`p1-${i}`),
      );
      (client.mempoolTxs as jest.Mock).mockResolvedValue(mempool);
      (client.confirmedTxs as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockRejectedValueOnce(new Error('esplora down'));

      const provider = new BitcoinProvider(client);
      const result = await provider.getAddressHistory('addr');

      expect(result).toHaveLength(26);
      expect(result[0].txid).toBe('m1');
    });
  });

  describe('getTx', () => {
    it('delegates to client.tx', async () => {
      const client = stubClient();
      const tx = makeConfirmedTx('abc');
      (client.tx as jest.Mock).mockResolvedValue(tx);

      const provider = new BitcoinProvider(client);
      const result = await provider.getTx('abc');

      expect(result).toBe(tx);
      expect(client.tx).toHaveBeenCalledWith('abc');
    });
  });

  describe('getAddressInfo', () => {
    it('computes balance as funded minus spent', async () => {
      const client = stubClient();
      (client.addressStats as jest.Mock).mockResolvedValue({
        address: 'addr',
        chain_stats: {
          funded_txo_sum: 5000000,
          spent_txo_sum: 1500000,
          tx_count: 10,
        },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
      });

      const provider = new BitcoinProvider(client);
      const info = await provider.getAddressInfo('addr');

      expect(info).toEqual({
        address: 'addr',
        addressType: 'wallet',
        balance: '3500000',
      });
    });
  });
});
