import { HeliusProvider } from './helius.provider';
import { HeliusClient, HeliusParsedTx, HeliusTokenTransfer, MintMetadata } from './helius-client';

/** Builds a stub HeliusClient with jest.fn() methods, typed as HeliusClient. */
function stubClient(): HeliusClient {
  return {
    addressTransactions: jest.fn(),
    parseTransaction: jest.fn(),
    getMintMetadata: jest.fn().mockResolvedValue(new Map()),
    getBalance: jest.fn(),
  } as unknown as HeliusClient;
}

function makeTokenTransfer(mint: string): HeliusTokenTransfer {
  return {
    fromUserAccount: 'from',
    toUserAccount: 'to',
    fromTokenAccount: 'fromAcct',
    toTokenAccount: 'toAcct',
    mint,
    tokenAmount: 1,
  };
}

function makeTx(
  signature: string,
  timestamp = 2_000_000_000,
  tokenTransfers: HeliusTokenTransfer[] = [],
): HeliusParsedTx {
  return {
    signature,
    timestamp,
    slot: 1,
    fee: 5000,
    feePayer: 'feePayer',
    type: 'TRANSFER',
    source: 'SYSTEM_PROGRAM',
    nativeTransfers: [],
    tokenTransfers,
    transactionError: null,
  };
}

describe('HeliusProvider', () => {
  describe('getAddressHistory — cursor pagination', () => {
    it('walks the before-signature cursor across full pages and stops on a partial page', async () => {
      const client = stubClient();
      const page1 = Array.from({ length: 100 }, (_, i) => makeTx(`p1-${i}`));
      const page2 = Array.from({ length: 100 }, (_, i) => makeTx(`p2-${i}`));
      const page3 = Array.from({ length: 40 }, (_, i) => makeTx(`p3-${i}`));
      (client.addressTransactions as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce(page3);

      const provider = new HeliusProvider(client);
      const result = await provider.getAddressHistory('addr', { maxTotal: 1000 });

      expect(client.addressTransactions).toHaveBeenCalledTimes(3);
      expect(client.addressTransactions).toHaveBeenNthCalledWith(1, 'addr', {
        beforeSignature: undefined,
        limit: 100,
      });
      expect(client.addressTransactions).toHaveBeenNthCalledWith(2, 'addr', {
        beforeSignature: 'p1-99',
        limit: 100,
      });
      expect(client.addressTransactions).toHaveBeenNthCalledWith(3, 'addr', {
        beforeSignature: 'p2-99',
        limit: 100,
      });
      expect(result.txs).toHaveLength(240);
    });
  });

  describe('getAddressHistory — maxTotal', () => {
    it('stops pagination once maxTotal is reached across pages and caps the result', async () => {
      const client = stubClient();
      const page1 = Array.from({ length: 100 }, (_, i) => makeTx(`p1-${i}`));
      const page2 = Array.from({ length: 100 }, (_, i) => makeTx(`p2-${i}`));
      (client.addressTransactions as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const provider = new HeliusProvider(client);
      const result = await provider.getAddressHistory('addr', { maxTotal: 150 });

      expect(client.addressTransactions).toHaveBeenCalledTimes(2);
      expect(result.txs).toHaveLength(150);
    });
  });

  describe('getAddressHistory — date stop', () => {
    it('halts the loop once a full page is entirely older than startTimestamp, and filters those out of the final result', async () => {
      const client = stubClient();
      const startTimestamp = 1000;
      const page1 = Array.from({ length: 100 }, (_, i) => makeTx(`p1-${i}`, 2000 - i));
      const page2 = Array.from({ length: 100 }, (_, i) => makeTx(`p2-${i}`, 500 - i));
      (client.addressTransactions as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      const provider = new HeliusProvider(client);
      const result = await provider.getAddressHistory('addr', {
        startTimestamp,
        maxTotal: 500,
      });

      expect(client.addressTransactions).toHaveBeenCalledTimes(2);
      expect(result.txs).toHaveLength(100);
      expect(result.txs.every((tx) => tx.timestamp >= startTimestamp)).toBe(true);
    });
  });

  describe('getAddressHistory — date window (false-empty regression)', () => {
    it('keeps paging past newer-than-window pages and returns the page that falls inside [start,end], not []', async () => {
      const client = stubClient();
      const startTimestamp = 1000;
      const endTimestamp = 2000;
      const page1 = Array.from({ length: 100 }, (_, i) => makeTx(`p1-${i}`, 5000 - i));
      const page2 = Array.from({ length: 100 }, (_, i) => makeTx(`p2-${i}`, 4000 - i));
      const page3 = Array.from({ length: 10 }, (_, i) => makeTx(`p3-${i}`, 1500 - i));
      (client.addressTransactions as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce(page3);

      const provider = new HeliusProvider(client);
      const result = await provider.getAddressHistory('addr', {
        startTimestamp,
        endTimestamp,
      });

      expect(client.addressTransactions).toHaveBeenCalledTimes(3);
      expect(result.txs).toHaveLength(10);
      expect(result.txs.map((tx) => tx.signature).sort()).toEqual(
        page3.map((tx) => tx.signature).sort(),
      );
      expect(
        result.txs.every((tx) => tx.timestamp >= startTimestamp && tx.timestamp <= endTimestamp),
      ).toBe(true);
    });
  });

  describe('getAddressHistory — mint batching', () => {
    it('fetches metadata once for the unique mints of KEPT txs only, deduped', async () => {
      const client = stubClient();
      const startTimestamp = 1000;
      // Kept tx (recent enough) with two transfers of the same mint + one other mint.
      const keptTx = makeTx('kept', 2000, [
        makeTokenTransfer('mintA'),
        makeTokenTransfer('mintA'),
        makeTokenTransfer('mintB'),
      ]);
      // Filtered-out tx (older than startTimestamp) whose mint must NOT appear in the batch.
      const droppedTx = makeTx('dropped', 100, [makeTokenTransfer('mintC')]);
      (client.addressTransactions as jest.Mock).mockResolvedValueOnce([keptTx, droppedTx]);

      const mintMeta = new Map<string, MintMetadata>([
        ['mintA', { mint: 'mintA', symbol: 'A', decimals: 6, resolved: true }],
        ['mintB', { mint: 'mintB', symbol: 'B', decimals: 9, resolved: true }],
      ]);
      (client.getMintMetadata as jest.Mock).mockResolvedValue(mintMeta);

      const provider = new HeliusProvider(client);
      const result = await provider.getAddressHistory('addr', { startTimestamp });

      expect(client.getMintMetadata).toHaveBeenCalledTimes(1);
      const calledMints = (client.getMintMetadata as jest.Mock).mock.calls[0][0] as string[];
      expect([...calledMints].sort()).toEqual(['mintA', 'mintB']);
      expect(result.mintMeta).toBe(mintMeta);
    });
  });

  describe('getAddressHistory — partial tolerance', () => {
    it('returns accumulated txs when addressTransactions rejects mid-loop, without throwing', async () => {
      const client = stubClient();
      const page1 = Array.from({ length: 100 }, (_, i) => makeTx(`p1-${i}`));
      (client.addressTransactions as jest.Mock)
        .mockResolvedValueOnce(page1)
        .mockRejectedValueOnce(new Error('helius down'));

      const provider = new HeliusProvider(client);
      const result = await provider.getAddressHistory('addr', { maxTotal: 500 });

      expect(result.txs).toHaveLength(100);
    });
  });

  describe('getTx', () => {
    it('delegates to parseTransaction and fetches mint metadata for that tx only', async () => {
      const client = stubClient();
      const tx = makeTx('sig', 2000, [makeTokenTransfer('mintA'), makeTokenTransfer('mintA')]);
      (client.parseTransaction as jest.Mock).mockResolvedValue(tx);
      const mintMeta = new Map<string, MintMetadata>([
        ['mintA', { mint: 'mintA', symbol: 'A', decimals: 6, resolved: true }],
      ]);
      (client.getMintMetadata as jest.Mock).mockResolvedValue(mintMeta);

      const provider = new HeliusProvider(client);
      const result = await provider.getTx('sig');

      expect(client.parseTransaction).toHaveBeenCalledWith('sig');
      expect(client.getMintMetadata).toHaveBeenCalledWith(['mintA']);
      expect(result.tx).toBe(tx);
      expect(result.mintMeta).toBe(mintMeta);
    });
  });

  describe('getAddressInfo', () => {
    it('returns wallet balance from getBalance', async () => {
      const client = stubClient();
      (client.getBalance as jest.Mock).mockResolvedValue('123456');

      const provider = new HeliusProvider(client);
      const info = await provider.getAddressInfo('addr');

      expect(info).toEqual({
        address: 'addr',
        addressType: 'wallet',
        balance: '123456',
      });
    });
  });
});
