import { EtherscanProvider } from './etherscan.provider';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';
import { CHAIN_CONFIGS } from './types';

/** Builds a minimal Response-like object for mocking global.fetch. */
function mockResponse(status: number, body: unknown): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const TX_HASH =
  '0xb7a0ee5870a518ecf9784e447d536c3c4f17a4e7cc853d3d5c38f46e7cbcc1ef';

const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const WETH = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619';
const NFT = '0x251be3a17af4892035c37ebf5890f4a4d889dcad';
const EOA = '0x51c0d73faec63d6471e434a483e0874f6cb17203';

const RELAYER = '0x9999999999999999999999999999999999999999';
const ROUTER = '0x07d79f0f6879f4d555431573320236628d16083e';
const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const CAROL = '0x3333333333333333333333333333333333333333';
const ZERO = '0x0000000000000000000000000000000000000000';

const TRANSFER =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const SELECTOR = {
  supports721: `0x01ffc9a780ac58cd${'0'.repeat(56)}`,
  supports1155: `0x01ffc9a7d9b67a26${'0'.repeat(56)}`,
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  name: '0x06fdde03',
};

const TRUE_WORD = `0x${'0'.repeat(63)}1`;
const CONTRACT_CODE = '0x60806040';

/** Sentinel for "this eth_getCode call fails at the HTTP layer". */
const HTTP_FAILURE = '__http_failure__';

function word(n: bigint | number): string {
  return BigInt(n).toString(16).padStart(64, '0');
}

function hexWord(n: bigint | number): string {
  return `0x${word(n)}`;
}

/** 20-byte address left-padded into a 32-byte topic. */
function topic(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

/** abi.encode(string) — offset, length, then the right-padded bytes. */
function abiString(value: string): string {
  const hex = Buffer.from(value, 'utf8').toString('hex');
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
  return `0x${word(32)}${word(Buffer.byteLength(value, 'utf8'))}${padded}`;
}

interface RpcStubs {
  tx?: unknown;
  receipt?: unknown;
  block?: unknown;
  /** address -> eth_getCode result (or HTTP_FAILURE). */
  code?: Record<string, string>;
  /** address -> calldata -> eth_call result. A miss reverts. */
  call?: Record<string, Record<string, string>>;
  /** address -> eth_getBalance result. */
  balance?: Record<string, string>;
}

const ERC20_CALLS: RpcStubs['call'] = {
  [USDC]: {
    [SELECTOR.decimals]: hexWord(6),
    [SELECTOR.symbol]: abiString('USDC'),
    [SELECTOR.name]: abiString('USD Coin'),
  },
  [WETH]: {
    [SELECTOR.decimals]: hexWord(18),
    [SELECTOR.symbol]: abiString('WETH'),
    [SELECTOR.name]: abiString('Wrapped Ether'),
  },
  [NFT]: {
    [SELECTOR.supports721]: TRUE_WORD,
    [SELECTOR.symbol]: abiString('COURTYARD'),
    [SELECTOR.name]: abiString('Courtyard Token'),
  },
};

/** The four receipt logs: three ERC-20 legs then one ERC-721 mint. */
const TRANSFER_LOGS = [
  {
    address: USDC,
    topics: [TRANSFER, topic(ALICE), topic(BOB)],
    data: hexWord(25_000_000n),
    logIndex: '0x0',
  },
  {
    address: USDC,
    topics: [TRANSFER, topic(BOB), topic(CAROL)],
    data: hexWord(5_000_000n),
    logIndex: '0x1',
  },
  {
    address: WETH,
    topics: [TRANSFER, topic(ALICE), topic(CAROL)],
    data: hexWord(1_000_000_000_000_000_000n),
    logIndex: '0x2',
  },
  {
    address: NFT,
    topics: [TRANSFER, topic(ZERO), topic(ALICE), hexWord(7)],
    data: '0x',
    logIndex: '0x3',
  },
];

const TX_RESULT = {
  hash: TX_HASH,
  from: RELAYER,
  to: ROUTER,
  value: '0x0',
  blockNumber: '0x40e2f3c',
  gas: '0x7a120',
  gasPrice: '0x6fc23ac00',
  nonce: '0x2a',
};

const RECEIPT_RESULT = {
  status: '0x1',
  gasUsed: '0x5208',
  contractAddress: null,
  logs: TRANSFER_LOGS,
};

const BLOCK_RESULT = { timestamp: '0x66b0a0a0' };

function makeProvider(): EtherscanProvider {
  // Fresh ResponseCache per provider so each test starts cold.
  return new EtherscanProvider(
    CHAIN_CONFIGS.polygon,
    'test-key',
    new RateLimiter(1000, 1000),
    new ResponseCache(),
  );
}

describe('EtherscanProvider', () => {
  let fetchSpy: jest.SpyInstance;
  let urls: string[];

  /** Routes the Etherscan v2 proxy calls by their `action` query param. */
  function installFetch(stubs: RpcStubs): void {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      const params = new URL(url).searchParams;
      const action = params.get('action');

      switch (action) {
        case 'eth_getTransactionByHash':
          return mockResponse(200, { result: stubs.tx ?? null });
        case 'eth_getTransactionReceipt':
          return mockResponse(200, { result: stubs.receipt ?? null });
        case 'eth_getBlockByNumber':
          return mockResponse(200, { result: stubs.block ?? null });
        case 'eth_getCode': {
          const addr = (params.get('address') ?? '').toLowerCase();
          const code = stubs.code?.[addr];
          if (code === HTTP_FAILURE) return mockResponse(500, {});
          return mockResponse(200, { result: code ?? '0x' });
        }
        case 'eth_call': {
          const to = (params.get('to') ?? '').toLowerCase();
          const data = params.get('data') ?? '';
          const answer = stubs.call?.[to]?.[data];
          if (answer === undefined) {
            return mockResponse(200, {
              error: { message: 'execution reverted' },
            });
          }
          return mockResponse(200, { result: answer });
        }
        case 'eth_getBalance': {
          const addr = (params.get('address') ?? '').toLowerCase();
          return mockResponse(200, {
            result: stubs.balance?.[addr] ?? '0x0',
          });
        }
        default:
          return mockResponse(200, {
            status: '0',
            message: 'NOTOK',
            result: `unexpected action ${action}`,
          });
      }
    });
  }

  beforeEach(() => {
    urls = [];
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('getTransaction', () => {
    it('decodes every transfer log in log order, ERC-20 and ERC-721 alike', async () => {
      installFetch({
        tx: TX_RESULT,
        receipt: RECEIPT_RESULT,
        block: BLOCK_RESULT,
        code: { [USDC]: CONTRACT_CODE, [WETH]: CONTRACT_CODE, [NFT]: CONTRACT_CODE },
        call: ERC20_CALLS,
      });

      const detail = await makeProvider().getTransaction(TX_HASH);

      expect(detail.transfers).toHaveLength(4);
      expect(detail.transfers?.map((t) => t.standard)).toEqual([
        'erc20',
        'erc20',
        'erc20',
        'erc721',
      ]);
      expect(detail.transfers?.[0]).toMatchObject({
        standard: 'erc20',
        contractAddress: USDC,
        from: ALICE,
        to: BOB,
        value: '25000000',
        logIndex: 0,
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
      });
      expect(detail.transfers?.[2]).toMatchObject({
        contractAddress: WETH,
        value: '1000000000000000000',
        symbol: 'WETH',
        decimals: 18,
      });
      expect(detail.transfers?.[3]).toMatchObject({
        standard: 'erc721',
        contractAddress: NFT,
        from: ZERO,
        to: ALICE,
        value: '1',
        tokenId: '7',
        symbol: 'COURTYARD',
        name: 'Courtyard Token',
      });
      expect(detail.transfers?.[3].decimals).toBeUndefined();
    });

    // The original bug: `account/tokentx` is ERC-20-only AND keyed by a party to
    // the transfer, so a relayed call returns zero rows. Nothing may ask it.
    it('never calls account/tokentx', async () => {
      installFetch({
        tx: TX_RESULT,
        receipt: RECEIPT_RESULT,
        block: BLOCK_RESULT,
        code: { [USDC]: CONTRACT_CODE, [WETH]: CONTRACT_CODE, [NFT]: CONTRACT_CODE },
        call: ERC20_CALLS,
      });

      await makeProvider().getTransaction(TX_HASH);

      expect(urls.some((u) => u.includes('action=tokentx'))).toBe(false);
      expect(urls.some((u) => u.includes('module=account'))).toBe(false);
    });

    it('keeps tokenTransfers populated with the ERC-20 legs and classifier metadata', async () => {
      installFetch({
        tx: TX_RESULT,
        receipt: RECEIPT_RESULT,
        block: BLOCK_RESULT,
        code: { [USDC]: CONTRACT_CODE, [WETH]: CONTRACT_CODE, [NFT]: CONTRACT_CODE },
        call: ERC20_CALLS,
      });

      const detail = await makeProvider().getTransaction(TX_HASH);

      expect(detail.tokenTransfers).toHaveLength(3);
      expect(
        detail.tokenTransfers.every((t) => t.contractAddress !== NFT),
      ).toBe(true);
      expect(detail.tokenTransfers[0]).toEqual({
        hash: TX_HASH,
        from: ALICE,
        to: BOB,
        value: '25000000',
        tokenName: 'USD Coin',
        tokenSymbol: 'USDC',
        tokenDecimal: '6',
        contractAddress: USDC,
        timeStamp: '1722851488',
        blockNumber: '68038460',
        gas: '500000',
        gasPrice: '30000000000',
        gasUsed: '21000',
        nonce: '42',
      });
      expect(detail.tokenTransfers[2]).toMatchObject({
        contractAddress: WETH,
        tokenSymbol: 'WETH',
        tokenDecimal: '18',
        value: '1000000000000000000',
      });
    });

    it('returns empty transfers and tokenTransfers for a receipt with no logs, leaving the native fields intact', async () => {
      installFetch({
        tx: { ...TX_RESULT, value: '0xde0b6b3a7640000' },
        receipt: { ...RECEIPT_RESULT, logs: [] },
        block: BLOCK_RESULT,
      });

      const detail = await makeProvider().getTransaction(TX_HASH);

      expect(detail.transfers).toEqual([]);
      expect(detail.tokenTransfers).toEqual([]);
      expect(detail.from).toBe(RELAYER);
      expect(detail.to).toBe(ROUTER);
      expect(detail.value).toBe('1000000000000000000');
      expect(detail.isError).toBe('0');
    });

    it('still returns the transfers when classification throws, just without metadata', async () => {
      installFetch({
        tx: TX_RESULT,
        receipt: RECEIPT_RESULT,
        block: BLOCK_RESULT,
        code: { [USDC]: CONTRACT_CODE, [WETH]: CONTRACT_CODE, [NFT]: CONTRACT_CODE },
        call: ERC20_CALLS,
      });

      const provider = makeProvider();
      jest
        .spyOn(provider['classifier'], 'classify')
        .mockRejectedValue(new Error('classifier exploded'));

      const detail = await provider.getTransaction(TX_HASH);

      expect(detail.transfers).toHaveLength(4);
      expect(detail.transfers?.[0].symbol).toBeUndefined();
      expect(detail.transfers?.[0].decimals).toBeUndefined();
      expect(detail.transfers?.[0].value).toBe('25000000');
      expect(detail.tokenTransfers).toHaveLength(3);
      expect(detail.tokenTransfers[0]).toMatchObject({
        tokenSymbol: '',
        tokenName: '',
        tokenDecimal: '',
      });
    });

    it('still returns the transfers when the on-chain probes fail at the network layer', async () => {
      installFetch({
        tx: TX_RESULT,
        receipt: RECEIPT_RESULT,
        block: BLOCK_RESULT,
        code: {
          [USDC]: HTTP_FAILURE,
          [WETH]: HTTP_FAILURE,
          [NFT]: HTTP_FAILURE,
        },
      });

      const detail = await makeProvider().getTransaction(TX_HASH);

      expect(detail.transfers).toHaveLength(4);
      expect(detail.transfers?.map((t) => t.standard)).toEqual([
        'erc20',
        'erc20',
        'erc20',
        'erc721',
      ]);
      expect(detail.transfers?.[0].symbol).toBeUndefined();
    });

    it('caps classification fan-out, but still returns every transfer', async () => {
      // A receipt touching more contracts than the cap must not turn one HTTP
      // request into ~minutes of rate-limited RPC calls. Legs past the cap keep
      // their decoded values and simply carry no metadata.
      const MAX_CLASSIFIED_CONTRACTS = 25;
      const CONTRACT_COUNT = 30;
      const contracts = Array.from(
        { length: CONTRACT_COUNT },
        (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`,
      );
      const logs = contracts.map((addr, i) => ({
        address: addr,
        topics: [TRANSFER, topic(ALICE), topic(BOB)],
        data: hexWord(1_000),
        logIndex: `0x${i.toString(16)}`,
      }));
      const call = Object.fromEntries(
        contracts.map((addr) => [
          addr,
          {
            [SELECTOR.decimals]: hexWord(18),
            [SELECTOR.symbol]: abiString('TKN'),
            [SELECTOR.name]: abiString('Token'),
          },
        ]),
      );
      const code = Object.fromEntries(contracts.map((addr) => [addr, CONTRACT_CODE]));

      installFetch({
        tx: TX_RESULT,
        receipt: { ...RECEIPT_RESULT, logs },
        block: BLOCK_RESULT,
        code,
        call,
      });

      const provider = makeProvider();
      const classifySpy = jest.spyOn(provider['classifier'], 'classify');

      const detail = await provider.getTransaction(TX_HASH);

      expect(detail.transfers).toHaveLength(CONTRACT_COUNT);
      expect(classifySpy).toHaveBeenCalledTimes(MAX_CLASSIFIED_CONTRACTS);
      // The first MAX_CLASSIFIED_CONTRACTS distinct contracts (log order) get
      // metadata; the rest keep their decoded value with no symbol/decimals.
      expect(detail.transfers?.[0].symbol).toBe('TKN');
      expect(detail.transfers?.[MAX_CLASSIFIED_CONTRACTS].symbol).toBeUndefined();
      expect(detail.transfers?.[CONTRACT_COUNT - 1].value).toBe('1000');
    });
  });

  describe('getAddressInfo', () => {
    it('reports the token standard and symbol for a token contract', async () => {
      installFetch({
        code: { [USDC]: CONTRACT_CODE },
        call: ERC20_CALLS,
        balance: { [USDC]: '0x0' },
      });

      const info = await makeProvider().getAddressInfo(USDC);

      expect(info).toEqual({
        address: USDC,
        addressType: 'contract',
        balance: '0',
        tokenStandard: 'erc20',
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
      });
    });

    it('reports no token standard for an EOA', async () => {
      installFetch({ balance: { [EOA]: '0xde0b6b3a7640000' } });

      const info = await makeProvider().getAddressInfo(EOA);

      expect(info).toEqual({
        address: EOA,
        addressType: 'wallet',
        balance: '1000000000000000000',
      });
      expect(info.tokenStandard).toBeUndefined();
    });

    // Unlike getTransaction (where a degraded, undecorated transfer is fine),
    // this result IS the finding: an unreachable RPC must not be reported as a
    // confident "this is a wallet".
    it('throws rather than reporting a confident wallet finding when eth_getCode fails', async () => {
      installFetch({
        code: { [EOA]: HTTP_FAILURE },
        balance: { [EOA]: '0xde0b6b3a7640000' },
      });

      await expect(makeProvider().getAddressInfo(EOA)).rejects.toThrow(
        /Could not determine address type/,
      );
    });
  });

  describe('NOTOK envelope on proxy routes', () => {
    /**
     * Etherscan reports rate-limiting and auth failures as
     * `{status:'0', message:'NOTOK', result:'<reason>'}` even on `module=proxy`
     * routes. There is no JSON-RPC `error` key, so before this guard the reason
     * STRING was returned as the call's result — and the classifier, testing
     * only `code !== '0x'`, read an English sentence as bytecode and asserted an
     * ordinary wallet was a contract.
     */
    function installNotokFetch(reason: string) {
      fetchSpy.mockImplementation(async () =>
        mockResponse(200, { status: '0', message: 'NOTOK', result: reason }),
      );
    }

    it('raises instead of handing the reason string back as a result', async () => {
      installNotokFetch('Max rate limit reached, please use API Key for higher rate limit');

      await expect(makeProvider().getAddressInfo(EOA)).rejects.toThrow(
        /Max rate limit reached/,
      );
    });

    it('never reports a rate-limited EOA as a contract', async () => {
      installNotokFetch('Invalid API Key (#err2)');

      await expect(makeProvider().getAddressInfo(EOA)).rejects.toThrow();
    });

    it('does not cache the failure, so a later successful call still works', async () => {
      const provider = makeProvider();
      installNotokFetch('Max rate limit reached');
      await expect(provider.getAddressInfo(EOA)).rejects.toThrow();

      // Re-point the SAME spy rather than restoring it — restoring would detach
      // it from global.fetch and let the call escape to the network.
      installFetch({ balance: { [EOA]: '0xde0b6b3a7640000' } });

      await expect(provider.getAddressInfo(EOA)).resolves.toEqual({
        address: EOA,
        addressType: 'wallet',
        balance: '1000000000000000000',
      });
    });
  });
});
