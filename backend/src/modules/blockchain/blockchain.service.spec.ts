import { BlockchainService } from './blockchain.service';
import { ProviderRegistry } from './provider-registry';
import { BlockchainProvider } from './blockchain-provider';
import { UtxoProvider } from './utxo-provider';
import { SolanaProvider } from './solana-provider';
import { EsploraTx, EsploraVin, EsploraVout } from './esplora-client';
import {
  HeliusNativeTransfer,
  HeliusParsedTx,
  HeliusTokenTransfer,
  MintMetadata,
} from './helius-client';
import {
  DecodedTransfer,
  RawAddressInfo,
  RawTransaction,
  RawTransactionDetail,
} from './types';

function stubUtxoProvider(overrides: Partial<UtxoProvider> = {}): jest.Mocked<UtxoProvider> {
  return {
    getAddressHistory: jest.fn(),
    getTx: jest.fn(),
    getAddressInfo: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<UtxoProvider>;
}

function stubSolanaProvider(overrides: Partial<SolanaProvider> = {}): jest.Mocked<SolanaProvider> {
  return {
    getAddressHistory: jest.fn(),
    getTx: jest.fn(),
    getAddressInfo: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<SolanaProvider>;
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

// Shape-valid bech32 (BIP-173 test vector) — fetchHistory/getAddressInfo now
// reject addresses whose shape doesn't match the chain, so fixtures must pass
// validateAddressForChain.
const A = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

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

const SOL_A = 'SubjectWa11et11111111111111111111111111111';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const EVM_ADDR = '0xabababababababababababababababababababab';

function solNativeTransfer(overrides: Partial<HeliusNativeTransfer> = {}): HeliusNativeTransfer {
  return {
    fromUserAccount: 'SenderWa11et',
    toUserAccount: SOL_A,
    amount: 1_500_000_000,
    ...overrides,
  };
}

function solTokenTransfer(overrides: Partial<HeliusTokenTransfer> = {}): HeliusTokenTransfer {
  return {
    fromUserAccount: 'SenderWa11et',
    toUserAccount: SOL_A,
    fromTokenAccount: 'FromAcct',
    toTokenAccount: 'ToAcct',
    mint: USDC_MINT,
    tokenAmount: 1.5,
    ...overrides,
  };
}

function heliusTx(overrides: Partial<HeliusParsedTx> = {}): HeliusParsedTx {
  return {
    signature: 'sol-sig-1',
    timestamp: 1_700_000_000,
    slot: 250_000_000,
    fee: 5_000,
    feePayer: 'SenderWa11et',
    type: 'TRANSFER',
    source: 'SYSTEM_PROGRAM',
    nativeTransfers: [],
    tokenTransfers: [],
    transactionError: null,
    ...overrides,
  };
}

describe('BlockchainService', () => {
  describe('bitcoin path', () => {
    let get: jest.Mock;
    let getUtxo: jest.Mock;
    let getSolana: jest.Mock;
    let utxo: jest.Mocked<UtxoProvider>;
    let service: BlockchainService;

    beforeEach(() => {
      utxo = stubUtxoProvider();
      get = jest.fn(() => {
        throw new Error('bitcoin uses the UTXO provider path (getUtxo)');
      });
      getUtxo = jest.fn().mockReturnValue(utxo);
      getSolana = jest.fn(() => {
        throw new Error('should not be called for bitcoin');
      });
      const registry = { get, getUtxo, getSolana } as unknown as ProviderRegistry;
      service = new BlockchainService(registry);
    });

    describe('fetchHistory', () => {
      it('never calls get() and maps rows via mapBtcHistory with utxo intact', async () => {
        utxo.getAddressHistory.mockResolvedValue([esploraTx()]);

        const result = await service.fetchHistory(A, 'bitcoin');

        expect(get).not.toHaveBeenCalled();
        expect(getSolana).not.toHaveBeenCalled();
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
    let getSolana: jest.Mock;
    let provider: jest.Mocked<BlockchainProvider>;
    let service: BlockchainService;

    beforeEach(() => {
      provider = stubBlockchainProvider();
      get = jest.fn().mockReturnValue(provider);
      getUtxo = jest.fn(() => {
        throw new Error('should not be called for ethereum');
      });
      getSolana = jest.fn(() => {
        throw new Error('should not be called for ethereum');
      });
      const registry = { get, getUtxo, getSolana } as unknown as ProviderRegistry;
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

      const result = await service.fetchHistory('0xabababababababababababababababababababab', 'ethereum');

      expect(getUtxo).not.toHaveBeenCalled();
      expect(getSolana).not.toHaveBeenCalled();
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

      const result = await service.fetchHistory('0xabababababababababababababababababababab', 'ethereum');

      expect(result.transactions).toHaveLength(1);
    });
  });

  describe('generic provider path — getTransaction/getAddressInfo', () => {
    let get: jest.Mock;
    let getUtxo: jest.Mock;
    let getSolana: jest.Mock;
    let provider: jest.Mocked<BlockchainProvider>;
    let service: BlockchainService;

    beforeEach(() => {
      provider = stubBlockchainProvider();
      get = jest.fn().mockReturnValue(provider);
      getUtxo = jest.fn(() => {
        throw new Error('should not be called for the EVM/Tron path');
      });
      getSolana = jest.fn(() => {
        throw new Error('should not be called for the EVM/Tron path');
      });
      const registry = { get, getUtxo, getSolana } as unknown as ProviderRegistry;
      service = new BlockchainService(registry);
    });

    function rawDetail(overrides: Partial<RawTransactionDetail> = {}): RawTransactionDetail {
      return {
        hash: '0xHASH1',
        from: '0xFROM',
        to: '0xTO',
        value: '0',
        timeStamp: '1700000000',
        blockNumber: '100',
        gas: '21000',
        gasUsed: '21000',
        gasPrice: '1',
        isError: '0',
        contractAddress: '',
        tokenTransfers: [],
        ...overrides,
      };
    }

    describe('getTransaction', () => {
      it('passes detail.transfers through to result.transfers, with token resolved per leg', async () => {
        const transfers: DecodedTransfer[] = [
          {
            standard: 'erc20',
            contractAddress: '0xtoken1',
            from: '0xfrom1',
            to: '0xto1',
            value: '1000000',
            logIndex: 2,
            symbol: 'USDC',
            decimals: 6,
          },
          {
            standard: 'erc721',
            contractAddress: '0xtoken2',
            from: '0xfrom2',
            to: '0xto2',
            value: '1',
            tokenId: '42',
            logIndex: 5,
            symbol: 'BAYC',
            decimals: 0,
          },
        ];
        provider.getTransaction.mockResolvedValue(rawDetail({ transfers }));

        const result = await service.getTransaction('0xHASH1', 'ethereum');

        expect(get).toHaveBeenCalledWith('ethereum');
        expect(result.transfers).toEqual([
          {
            standard: 'erc20',
            from: '0xfrom1',
            to: '0xto1',
            amount: '1000000',
            token: { address: '0xtoken1', symbol: 'USDC', decimals: 6 },
            tokenId: undefined,
            logIndex: 2,
          },
          {
            standard: 'erc721',
            from: '0xfrom2',
            to: '0xto2',
            amount: '1',
            token: { address: '0xtoken2', symbol: 'BAYC', decimals: 0 },
            tokenId: '42',
            logIndex: 5,
          },
        ]);
      });

      it('yields transfers: [] and leaves tokenTransfers unchanged when the provider omits transfers (Tron shape)', async () => {
        const tokenTransfers = [
          {
            hash: '0xHASH1',
            from: '0xfrom',
            to: '0xto',
            value: '500',
            tokenName: 'Tether USD',
            tokenSymbol: 'USDT',
            tokenDecimal: '6',
            contractAddress: '0xusdt',
            timeStamp: '1700000000',
            blockNumber: '100',
            gas: '0',
            gasPrice: '0',
            gasUsed: '0',
            nonce: '1',
          },
        ];
        // No `transfers` field at all — the shape Tron/Solana providers produce.
        provider.getTransaction.mockResolvedValue(rawDetail({ tokenTransfers }));

        const result = await service.getTransaction('0xHASH1', 'tron');

        expect(result.transfers).toEqual([]);
        expect(result.tokenTransfers).toEqual([
          {
            from: '0xfrom',
            to: '0xto',
            amount: '500',
            token: { address: '0xusdt', symbol: 'USDT', decimals: 6 },
          },
        ]);
      });
    });

    describe('getAddressInfo', () => {
      it('passes tokenStandard (and symbol/decimals/name) through when the provider supplies them', async () => {
        provider.getAddressInfo.mockResolvedValue({
          address: EVM_ADDR,
          addressType: 'contract',
          balance: '0',
          tokenStandard: 'erc20',
          symbol: 'USDC',
          decimals: 6,
          name: 'USD Coin',
        });

        const result = await service.getAddressInfo(EVM_ADDR, 'ethereum');

        expect(result.tokenStandard).toBe('erc20');
        expect(result.symbol).toBe('USDC');
        expect(result.decimals).toBe(6);
        expect(result.name).toBe('USD Coin');
      });

      it('omits tokenStandard/symbol/decimals/name when the provider does not supply them', async () => {
        provider.getAddressInfo.mockResolvedValue({
          address: EVM_ADDR,
          addressType: 'wallet',
          balance: '123',
        });

        const result = await service.getAddressInfo(EVM_ADDR, 'ethereum');

        expect(result.tokenStandard).toBeUndefined();
        expect(result.symbol).toBeUndefined();
        expect(result.decimals).toBeUndefined();
        expect(result.name).toBeUndefined();
      });
    });
  });

  describe('solana path', () => {
    let get: jest.Mock;
    let getUtxo: jest.Mock;
    let getSolana: jest.Mock;
    let solana: jest.Mocked<SolanaProvider>;
    let service: BlockchainService;

    beforeEach(() => {
      solana = stubSolanaProvider();
      get = jest.fn(() => {
        throw new Error('solana uses the Solana provider path (getSolana)');
      });
      getUtxo = jest.fn(() => {
        throw new Error('should not be called for solana');
      });
      getSolana = jest.fn().mockReturnValue(solana);
      const registry = { get, getUtxo, getSolana } as unknown as ProviderRegistry;
      service = new BlockchainService(registry);
    });

    describe('fetchHistory', () => {
      it('never calls get()/getUtxo() and maps rows via mapSolanaHistory with solana context intact', async () => {
        solana.getAddressHistory.mockResolvedValue({
          txs: [heliusTx({ nativeTransfers: [solNativeTransfer()] })],
          mintMeta: new Map(),
        });

        const result = await service.fetchHistory(SOL_A, 'solana');

        expect(get).not.toHaveBeenCalled();
        expect(getUtxo).not.toHaveBeenCalled();
        expect(result.chain).toBe('solana');
        expect(result.address).toBe(SOL_A);
        expect(result.transactions).toHaveLength(1);
        const row = result.transactions[0];
        expect(row.from).toBe('SenderWa11et');
        expect(row.to).toBe(SOL_A);
        expect(row.amount).toBe('1500000000');
        expect(row.token).toEqual({ address: '', symbol: 'SOL', decimals: 9 });
        expect(row.solana).toEqual({
          transferIndex: 0,
          feePayer: 'SenderWa11et',
          kind: 'native',
          type: 'TRANSFER',
          source: 'SYSTEM_PROGRAM',
          slot: 250_000_000,
        });
      });

      it('forwards maxTotal and normalized start/end timestamps to getAddressHistory', async () => {
        solana.getAddressHistory.mockResolvedValue({ txs: [], mintMeta: new Map() });

        await service.fetchHistory(SOL_A, 'solana', {
          maxTotal: 50,
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        } as never);

        expect(solana.getAddressHistory).toHaveBeenCalledWith(SOL_A, {
          maxTotal: 50,
          startTimestamp: Math.floor(Date.UTC(2024, 0, 1, 0, 0, 0) / 1000),
          endTimestamp: Math.floor(Date.UTC(2024, 0, 31, 23, 59, 59) / 1000),
        });
      });

      it('passes undefined maxTotal/timestamps through when no options given', async () => {
        solana.getAddressHistory.mockResolvedValue({ txs: [], mintMeta: new Map() });

        await service.fetchHistory(SOL_A, 'solana');

        expect(solana.getAddressHistory).toHaveBeenCalledWith(SOL_A, {
          maxTotal: undefined,
          startTimestamp: undefined,
          endTimestamp: undefined,
        });
      });

      it('sorts returned rows by timestamp desc', async () => {
        const older = heliusTx({
          signature: 'sol-old',
          timestamp: 1_000,
          nativeTransfers: [solNativeTransfer()],
        });
        const newer = heliusTx({
          signature: 'sol-new',
          timestamp: 5_000,
          nativeTransfers: [solNativeTransfer()],
        });
        solana.getAddressHistory.mockResolvedValue({ txs: [older, newer], mintMeta: new Map() });

        const result = await service.fetchHistory(SOL_A, 'solana');

        expect(result.transactions.map((t) => t.txHash)).toEqual(['sol-new', 'sol-old']);
      });
    });

    describe('getTransaction', () => {
      it('builds the representative detail: from=feePayer, to/amount from the largest transfer, tokenTransfers populated', async () => {
        const mintMeta: Map<string, MintMetadata> = new Map([
          [USDC_MINT, { mint: USDC_MINT, symbol: 'USDC', decimals: 6, resolved: true }],
        ]);
        const tx = heliusTx({
          signature: 'sol-sig-detail',
          feePayer: 'FeePayerWa11et',
          type: 'SWAP',
          source: 'JUPITER',
          nativeTransfers: [
            solNativeTransfer({ fromUserAccount: 'FeePayerWa11et', toUserAccount: 'Poo1Wa11et', amount: 500_000_000 }),
          ],
          tokenTransfers: [
            solTokenTransfer({
              fromUserAccount: 'Poo1Wa11et',
              toUserAccount: 'FeePayerWa11et',
              tokenAmount: 100,
              mint: USDC_MINT,
              fromTokenAccount: 'PoolUsdcAcct',
              toTokenAccount: 'FeePayerUsdcAcct',
            }),
          ],
        });
        solana.getTx.mockResolvedValue({ tx, mintMeta });

        const result = await service.getTransaction('sol-sig-detail', 'solana');

        expect(get).not.toHaveBeenCalled();
        expect(getUtxo).not.toHaveBeenCalled();
        expect(result.txHash).toBe('sol-sig-detail');
        expect(result.chain).toBe('solana');
        expect(result.from).toBe('FeePayerWa11et');
        // The SPL leg (100 USDC) is the largest transfer by decimal-adjusted
        // quantity, beating the 0.5 SOL native leg.
        expect(result.to).toBe('FeePayerWa11et');
        expect(result.amount).toBe('100000000');
        expect(result.token).toEqual({ address: USDC_MINT, symbol: 'USDC', decimals: 6 });
        expect(result.isError).toBe(false);
        expect(result.tokenTransfers).toEqual([
          {
            from: 'Poo1Wa11et',
            to: 'FeePayerWa11et',
            amount: '100000000',
            token: { address: USDC_MINT, symbol: 'USDC', decimals: 6 },
          },
        ]);
        expect(result.solana).toEqual({
          transferIndex: 1,
          feePayer: 'FeePayerWa11et',
          kind: 'spl',
          mint: USDC_MINT,
          decimals: 6,
          fromTokenAccount: 'PoolUsdcAcct',
          toTokenAccount: 'FeePayerUsdcAcct',
          type: 'SWAP',
          source: 'JUPITER',
          slot: 250_000_000,
        });
      });

      it('picks the native leg as representative when it is the larger decimal-adjusted transfer', async () => {
        const tx = heliusTx({
          signature: 'sol-sig-native-wins',
          feePayer: 'FeePayerWa11et',
          nativeTransfers: [
            solNativeTransfer({ fromUserAccount: 'FeePayerWa11et', toUserAccount: 'RecipientWa11et', amount: 2_000_000_000 }),
          ],
          tokenTransfers: [
            solTokenTransfer({
              fromUserAccount: 'FeePayerWa11et',
              toUserAccount: 'OtherWa11et',
              tokenAmount: 0.01,
              mint: USDC_MINT,
            }),
          ],
        });
        solana.getTx.mockResolvedValue({
          tx,
          mintMeta: new Map([[USDC_MINT, { mint: USDC_MINT, symbol: 'USDC', decimals: 6, resolved: true }]]),
        });

        const result = await service.getTransaction('sol-sig-native-wins', 'solana');

        expect(result.to).toBe('RecipientWa11et');
        expect(result.amount).toBe('2000000000');
        expect(result.token).toEqual({ address: '', symbol: 'SOL', decimals: 9 });
        expect(result.solana?.kind).toBe('native');
      });

      it('reports isError true for a transaction that carries a transactionError (F4)', async () => {
        const tx = heliusTx({
          signature: 'sol-sig-failed',
          feePayer: 'FeePayerWa11et',
          nativeTransfers: [
            solNativeTransfer({ fromUserAccount: 'FeePayerWa11et', toUserAccount: 'RecipientWa11et' }),
          ],
          transactionError: { InstructionError: [0, { Custom: 1 }] },
        });
        solana.getTx.mockResolvedValue({ tx, mintMeta: new Map() });

        const result = await service.getTransaction('sol-sig-failed', 'solana');

        expect(result.isError).toBe(true);
      });

      it('filters tokenTransfers entries with a null fromUserAccount or toUserAccount instead of coalescing to "" (F5)', async () => {
        const tx = heliusTx({
          signature: 'sol-sig-null-owner',
          feePayer: 'FeePayerWa11et',
          nativeTransfers: [],
          tokenTransfers: [
            solTokenTransfer({
              fromUserAccount: null,
              toUserAccount: 'FeePayerWa11et',
              tokenAmount: 5,
              mint: USDC_MINT,
            }),
            solTokenTransfer({
              fromUserAccount: 'Poo1Wa11et',
              toUserAccount: 'FeePayerWa11et',
              tokenAmount: 1,
              mint: USDC_MINT,
            }),
          ],
        });
        solana.getTx.mockResolvedValue({
          tx,
          mintMeta: new Map([[USDC_MINT, { mint: USDC_MINT, symbol: 'USDC', decimals: 6, resolved: true }]]),
        });

        const result = await service.getTransaction('sol-sig-null-owner', 'solana');

        expect(result.tokenTransfers).toHaveLength(1);
        expect(result.tokenTransfers.every((t) => t.from !== '' && t.to !== '')).toBe(true);
        expect(result.tokenTransfers[0]).toEqual({
          from: 'Poo1Wa11et',
          to: 'FeePayerWa11et',
          amount: '1000000',
          token: { address: USDC_MINT, symbol: 'USDC', decimals: 6 },
        });
      });
    });

    describe('getAddressInfo', () => {
      it('never calls get()/getUtxo() and wraps the Solana provider result', async () => {
        const raw: RawAddressInfo = { address: SOL_A, addressType: 'wallet', balance: '999999' };
        solana.getAddressInfo.mockResolvedValue(raw);

        const result = await service.getAddressInfo(SOL_A, 'solana');

        expect(get).not.toHaveBeenCalled();
        expect(getUtxo).not.toHaveBeenCalled();
        expect(result).toEqual({ address: SOL_A, addressType: 'wallet', balance: '999999', label: undefined });
      });
    });
  });

  describe('address/chain shape guard', () => {
    // Every provider getter throws — proving validation rejects BEFORE any
    // provider is touched. This is the backstop for the Bitcoin/Solana base58
    // ambiguity: a legacy 1…/3… address passed with chain 'solana' must bounce
    // with a corrective error instead of silently querying Helius.
    let service: BlockchainService;

    beforeEach(() => {
      const registry = {
        get: jest.fn(() => { throw new Error('provider must not be reached'); }),
        getUtxo: jest.fn(() => { throw new Error('provider must not be reached'); }),
        getSolana: jest.fn(() => { throw new Error('provider must not be reached'); }),
      } as unknown as ProviderRegistry;
      service = new BlockchainService(registry);
    });

    const BTC_LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
    const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111';

    it('fetchHistory rejects a legacy BTC address on chain solana with a corrective message', async () => {
      await expect(service.fetchHistory(BTC_LEGACY, 'solana')).rejects.toThrow(
        'use chain "bitcoin", not "solana"',
      );
    });

    it('getAddressInfo rejects a legacy BTC address on chain solana', async () => {
      await expect(service.getAddressInfo(BTC_LEGACY, 'solana')).rejects.toThrow(
        'use chain "bitcoin", not "solana"',
      );
    });

    it('fetchHistory rejects a BTC address on chain ethereum', async () => {
      await expect(service.fetchHistory(BTC_LEGACY, 'ethereum')).rejects.toThrow(
        'ethereum requires an EVM address',
      );
    });

    it('the Solana System Program is exempt from BTC-first overlap resolution', async () => {
      // Shape-collides with BTC legacy (32 base58 '1's) but is a genuine,
      // well-known Solana address — must reach the provider, not bounce.
      await expect(
        service.getAddressInfo(SOLANA_SYSTEM_PROGRAM, 'solana'),
      ).rejects.toThrow('provider must not be reached');
    });
  });
});
