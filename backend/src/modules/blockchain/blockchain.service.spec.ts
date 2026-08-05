import { BlockchainService } from './blockchain.service';
import { ProviderRegistry } from './provider-registry';
import { BlockchainProvider } from './blockchain-provider';
import { UtxoProvider } from './utxo-provider';
import { EsploraTx, EsploraVin, EsploraVout } from './esplora-client';
import { RawAddressInfo, RawTransaction } from './types';

function stubUtxoProvider(overrides: Partial<UtxoProvider> = {}): jest.Mocked<UtxoProvider> {
  return {
    getAddressHistory: jest.fn(),
    getTx: jest.fn(),
    getAddressInfo: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<UtxoProvider>;
}

function stubBlockchainProvider(
  overrides: Partial<BlockchainProvider> = {},
): jest.Mocked<BlockchainProvider> {
  return {
    getTransactions: jest.fn(),
    getTokenTransfers: jest.fn(),
    getTransaction: jest.fn(),
    getAddressInfo: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<BlockchainProvider>;
}

const A = 'bc1qsubjectaddress0000000000000000000000';

function vin(overrides: Partial<EsploraVin> = {}): EsploraVin {
  return {
    txid: 'prev-txid',
    vout: 0,
    is_coinbase: false,
    prevout: {
      scriptpubkey_address: 'bc1qsender',
      scriptpubkey_type: 'v0_p2wpkh',
      value: 100_000,
    },
    ...overrides,
  };
}

function vout(overrides: Partial<EsploraVout> = {}): EsploraVout {
  return {
    scriptpubkey_address: A,
    scriptpubkey_type: 'v0_p2wpkh',
    value: 60_000,
    ...overrides,
  };
}

function esploraTx(overrides: Partial<EsploraTx> = {}): EsploraTx {
  return {
    txid: 'tx-1',
    fee: 500,
    vin: [vin()],
    vout: [vout()],
    status: { confirmed: true, block_height: 800_000, block_time: 1_700_000_000 },
    ...overrides,
  };
}

describe('BlockchainService', () => {
  describe('bitcoin path', () => {
    let get: jest.Mock;
    let getUtxo: jest.Mock;
    let utxo: jest.Mocked<UtxoProvider>;
    let service: BlockchainService;

    beforeEach(() => {
      utxo = stubUtxoProvider();
      get = jest.fn(() => {
        throw new Error('bitcoin uses the UTXO provider path (getUtxo)');
      });
      getUtxo = jest.fn().mockReturnValue(utxo);
      const registry = { get, getUtxo } as unknown as ProviderRegistry;
      service = new BlockchainService(registry);
    });

    describe('fetchHistory', () => {
      it('never calls get() and maps rows via mapBtcHistory with utxo intact', async () => {
        utxo.getAddressHistory.mockResolvedValue([esploraTx()]);

        const result = await service.fetchHistory(A, 'bitcoin');

        expect(get).not.toHaveBeenCalled();
        expect(result.chain).toBe('bitcoin');
        expect(result.address).toBe(A);
        expect(result.transactions).toHaveLength(1);
        const row = result.transactions[0];
        expect(row.token).toEqual({ address: '', symbol: 'BTC', decimals: 8 });
        expect(row.utxo).toBeDefined();
        expect(row.utxo?.inputs[0]).toMatchObject({ address: 'bc1qsender' });
        expect(row.utxo?.outputs[0]).toMatchObject({ address: A, value: '60000' });
      });

      it('forwards maxTotal and normalized start/end timestamps to getAddressHistory', async () => {
        utxo.getAddressHistory.mockResolvedValue([]);

        await service.fetchHistory(A, 'bitcoin', {
          maxTotal: 50,
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        } as never);

        expect(utxo.getAddressHistory).toHaveBeenCalledWith(A, {
          maxTotal: 50,
          startTimestamp: Math.floor(Date.UTC(2024, 0, 1, 0, 0, 0) / 1000),
          endTimestamp: Math.floor(Date.UTC(2024, 0, 31, 23, 59, 59) / 1000),
        });
      });

      it('passes undefined maxTotal/timestamps through when no options given', async () => {
        utxo.getAddressHistory.mockResolvedValue([]);

        await service.fetchHistory(A, 'bitcoin');

        expect(utxo.getAddressHistory).toHaveBeenCalledWith(A, {
          maxTotal: undefined,
          startTimestamp: undefined,
          endTimestamp: undefined,
        });
      });

      it('sorts returned rows by timestamp desc', async () => {
        const older = esploraTx({
          txid: 'tx-old',
          status: { confirmed: true, block_height: 1, block_time: 1_000 },
        });
        const newer = esploraTx({
          txid: 'tx-new',
          status: { confirmed: true, block_height: 2, block_time: 5_000 },
        });
        utxo.getAddressHistory.mockResolvedValue([older, newer]);

        const result = await service.fetchHistory(A, 'bitcoin');

        expect(result.transactions.map((t) => t.txHash)).toEqual(['tx-new', 'tx-old']);
      });
    });

    describe('getTransaction', () => {
      it('never calls get() and returns representative from/to with full utxo', async () => {
        utxo.getTx.mockResolvedValue(esploraTx());

        const result = await service.getTransaction('tx-1', 'bitcoin');

        expect(get).not.toHaveBeenCalled();
        expect(result.txHash).toBe('tx-1');
        expect(result.from).toBe('bc1qsender');
        expect(result.to).toBe(A);
        expect(result.amount).toBe('60000');
        expect(result.chain).toBe('bitcoin');
        expect(result.token).toEqual({ address: '', symbol: 'BTC', decimals: 8 });
        expect(result.isError).toBe(false);
        expect(result.tokenTransfers).toEqual([]);
        expect(result.blockNumber).toBe(800_000);
        expect(result.utxo).toBeDefined();
        expect(result.utxo?.inputs).toHaveLength(1);
        expect(result.utxo?.outputs).toHaveLength(1);
      });

      it('picks the largest non-change, non-op_return output as the representative `to`', async () => {
        utxo.getTx.mockResolvedValue(
          esploraTx({
            vout: [
              vout({ scriptpubkey_address: 'bc1qsmall', value: 1_000 }),
              { scriptpubkey_type: 'op_return', value: 0 },
              vout({ scriptpubkey_address: 'bc1qbig', value: 90_000 }),
            ],
          }),
        );

        const result = await service.getTransaction('tx-1', 'bitcoin');

        expect(result.to).toBe('bc1qbig');
        expect(result.amount).toBe('90000');
      });

      it('falls back to "coinbase" for from and "" for to when there is no representative address', async () => {
        utxo.getTx.mockResolvedValue(
          esploraTx({
            vin: [
              vin({
                prevout: null,
                is_coinbase: true,
                txid: '0'.repeat(64),
                vout: 4_294_967_295,
              }),
            ],
            vout: [{ scriptpubkey_type: 'op_return', value: 0 }],
          }),
        );

        const result = await service.getTransaction('tx-coinbase', 'bitcoin');

        expect(result.from).toBe('coinbase');
        expect(result.to).toBe('');
      });

      it('stamps the current time when the transaction is unconfirmed', async () => {
        const before = Date.now();
        utxo.getTx.mockResolvedValue(esploraTx({ status: { confirmed: false } }));

        const result = await service.getTransaction('tx-mempool', 'bitcoin');
        const after = Date.now();

        expect(result.blockNumber).toBe(0);
        const parsed = Date.parse(result.timestamp);
        expect(parsed).toBeGreaterThanOrEqual(before - 1000);
        expect(parsed).toBeLessThanOrEqual(after + 1000);
      });
    });

    describe('getAddressInfo', () => {
      it('never calls get() and wraps the UTXO provider result', async () => {
        const raw: RawAddressInfo = { address: A, addressType: 'wallet', balance: '12345' };
        utxo.getAddressInfo.mockResolvedValue(raw);

        const result = await service.getAddressInfo(A, 'bitcoin');

        expect(get).not.toHaveBeenCalled();
        expect(result).toEqual({ address: A, addressType: 'wallet', balance: '12345', label: undefined });
      });
    });
  });

  describe('ethereum regression', () => {
    let get: jest.Mock;
    let getUtxo: jest.Mock;
    let provider: jest.Mocked<BlockchainProvider>;
    let service: BlockchainService;

    beforeEach(() => {
      provider = stubBlockchainProvider();
      get = jest.fn().mockReturnValue(provider);
      getUtxo = jest.fn(() => {
        throw new Error('should not be called for ethereum');
      });
      const registry = { get, getUtxo } as unknown as ProviderRegistry;
      service = new BlockchainService(registry);
    });

    function rawTx(overrides: Partial<RawTransaction> = {}): RawTransaction {
      return {
        hash: '0xHASH1',
        from: '0xFROM',
        to: '0xTO',
        value: '1000000000000000000',
        timeStamp: '1700000000',
        blockNumber: '100',
        gas: '21000',
        gasPrice: '1',
        gasUsed: '21000',
        isError: '0',
        input: '0x',
        contractAddress: '',
        nonce: '1',
        ...overrides,
      };
    }

    it('lowercases addresses (normalizeAddr) and filters zero-value txs with no calldata', async () => {
      const txs: RawTransaction[] = [
        rawTx({ hash: '0xAAA', from: '0xFROM', to: '0xTO', value: '1000000000000000000' }),
        rawTx({ hash: '0xBBB', from: '0xFROM2', to: '0xTO2', value: '0', input: '' }),
      ];
      provider.getTransactions.mockResolvedValue(txs);
      provider.getTokenTransfers.mockResolvedValue([]);

      const result = await service.fetchHistory('0xADDRESS', 'ethereum');

      expect(getUtxo).not.toHaveBeenCalled();
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].from).toBe('0xfrom');
      expect(result.transactions[0].to).toBe('0xto');
      expect(result.transactions[0].token).toEqual({ address: '0x', symbol: 'ETH', decimals: 18 });
      expect(result.transactions[0].utxo).toBeUndefined();
    });

    it('keeps a zero-value tx when input carries contract-call calldata', async () => {
      const txs: RawTransaction[] = [
        rawTx({ hash: '0xCCC', value: '0', input: '0xa9059cbb000...' }),
      ];
      provider.getTransactions.mockResolvedValue(txs);
      provider.getTokenTransfers.mockResolvedValue([]);

      const result = await service.fetchHistory('0xADDRESS', 'ethereum');

      expect(result.transactions).toHaveLength(1);
    });
  });
});
