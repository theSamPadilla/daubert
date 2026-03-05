import { BlockchainProvider } from './blockchain-provider';
import {
  ChainConfig,
  RawTransaction,
  RawTokenTransfer,
  RawTransactionDetail,
  RawAddressInfo,
  FetchOptions,
  ETHERSCAN_V2_BASE,
} from './types';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';

const TX_CACHE_TTL = 60 * 60 * 1000; // 1hr
const TOKEN_META_TTL = 24 * 60 * 60 * 1000; // 24hr

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

export class EtherscanProvider implements BlockchainProvider {
  constructor(
    private chain: ChainConfig,
    private apiKey: string,
    private rateLimiter: RateLimiter,
    private cache: ResponseCache,
  ) {}

  private async fetchApi<T>(
    module: string,
    action: string,
    params: Record<string, string>,
  ): Promise<T> {
    const allParams = {
      chainid: String(this.chain.chainId),
      ...params,
      module,
      action,
      apikey: this.apiKey,
    };
    const cacheKey = this.cache.buildKey(
      this.chain.id,
      `${module}/${action}`,
      params,
    );

    const cached = this.cache.get<T>(cacheKey);
    if (cached !== null) return cached;

    await this.rateLimiter.acquire();

    const qs = new URLSearchParams(allParams).toString();
    const res = await fetch(`${ETHERSCAN_V2_BASE}?${qs}`);
    if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);

    const json: EtherscanResponse<T> = await res.json();
    if (json.status !== '1' && json.message !== 'No transactions found') {
      throw new Error(`Etherscan: ${json.message} (${json.result})`);
    }

    const result =
      json.status === '1' ? json.result : ([] as unknown as T);

    const ttl = action.includes('token') ? TOKEN_META_TTL : TX_CACHE_TTL;
    this.cache.set(cacheKey, result, ttl);

    return result;
  }

  async getTransactions(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTransaction[]> {
    return this.fetchApi<RawTransaction[]>('account', 'txlist', {
      address,
      startblock: String(options?.startBlock ?? 0),
      endblock: String(options?.endBlock ?? 99999999),
      page: String(options?.page ?? 1),
      offset: String(options?.offset ?? 100),
      sort: options?.sort ?? 'desc',
    });
  }

  async getTokenTransfers(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTokenTransfer[]> {
    return this.fetchApi<RawTokenTransfer[]>('account', 'tokentx', {
      address,
      startblock: String(options?.startBlock ?? 0),
      endblock: String(options?.endBlock ?? 99999999),
      page: String(options?.page ?? 1),
      offset: String(options?.offset ?? 100),
      sort: options?.sort ?? 'desc',
    });
  }

  async getTransaction(txHash: string): Promise<RawTransactionDetail> {
    // Fetch tx details and receipt in parallel
    const [txResult, receiptResult] = await Promise.all([
      this.fetchApi<any>('proxy', 'eth_getTransactionByHash', { txhash: txHash }),
      this.fetchApi<any>('proxy', 'eth_getTransactionReceipt', { txhash: txHash }),
    ]);

    if (!txResult) throw new Error(`Transaction not found: ${txHash}`);

    const blockNumber = txResult.blockNumber
      ? parseInt(txResult.blockNumber, 16)
      : 0;

    // Get block for timestamp
    let timestamp = '0';
    try {
      const block = await this.fetchApi<any>('proxy', 'eth_getBlockByNumber', {
        tag: txResult.blockNumber,
        boolean: 'false',
      });
      if (block?.timestamp) {
        timestamp = String(parseInt(block.timestamp, 16));
      }
    } catch {
      // Timestamp unavailable
    }

    // Look up token transfers for this tx hash
    let tokenTransfers: RawTokenTransfer[] = [];
    try {
      const allTokenTxs = await this.fetchApi<RawTokenTransfer[]>(
        'account',
        'tokentx',
        {
          address: txResult.from,
          startblock: String(blockNumber),
          endblock: String(blockNumber),
          page: '1',
          offset: '100',
          sort: 'asc',
        },
      );
      tokenTransfers = allTokenTxs.filter(
        (t) => t.hash.toLowerCase() === txHash.toLowerCase(),
      );
    } catch {
      // Token transfers unavailable
    }

    return {
      hash: txResult.hash,
      from: txResult.from,
      to: txResult.to || '',
      value: txResult.value
        ? BigInt(txResult.value).toString()
        : '0',
      timeStamp: timestamp,
      blockNumber: String(blockNumber),
      gas: txResult.gas ? BigInt(txResult.gas).toString() : '0',
      gasUsed: receiptResult?.gasUsed
        ? BigInt(receiptResult.gasUsed).toString()
        : '0',
      gasPrice: txResult.gasPrice
        ? BigInt(txResult.gasPrice).toString()
        : '0',
      isError: receiptResult?.status === '0x0' ? '1' : '0',
      contractAddress: receiptResult?.contractAddress || '',
      tokenTransfers,
    };
  }

  async getAddressInfo(address: string): Promise<RawAddressInfo> {
    const [code, balanceHex] = await Promise.all([
      this.fetchApi<string>('proxy', 'eth_getCode', { address, tag: 'latest' }),
      this.fetchApi<string>('proxy', 'eth_getBalance', { address, tag: 'latest' }),
    ]);

    const isContract = !!code && code !== '0x' && code !== '0x0';
    const balance = balanceHex ? BigInt(balanceHex).toString() : '0';

    return {
      address,
      addressType: isContract ? 'contract' : 'wallet',
      balance,
    };
  }
}
