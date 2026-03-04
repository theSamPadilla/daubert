import { BlockchainProvider } from './blockchain-provider';
import {
  ChainConfig,
  RawTransaction,
  RawTokenTransfer,
  TokenMetadata,
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

  async getTokenMetadata(
    _tokenAddress: string,
  ): Promise<TokenMetadata | null> {
    return null;
  }
}
