import { BlockchainProvider } from './BlockchainProvider';
import { ChainConfig, RawTransaction, RawTokenTransfer, TokenMetadata, FetchOptions } from './types';
import { RateLimiter } from './RateLimiter';
import { ResponseCache } from './ResponseCache';

const TX_CACHE_TTL = 60 * 60 * 1000; // 1hr
const TOKEN_META_TTL = 24 * 60 * 60 * 1000; // 24hr

interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

export class EtherscanProvider implements BlockchainProvider {
  private apiKey: string;
  private rateLimiter: RateLimiter;
  private cache: ResponseCache;

  constructor(
    private chain: ChainConfig,
    rateLimiter: RateLimiter,
    cache: ResponseCache
  ) {
    this.apiKey = (import.meta as any).env?.[chain.apiKeyEnvVar] || '';
    this.rateLimiter = rateLimiter;
    this.cache = cache;
  }

  private async fetchApi<T>(module: string, action: string, params: Record<string, string>): Promise<T> {
    const allParams = { ...params, module, action, apikey: this.apiKey };
    const cacheKey = this.cache.buildKey(this.chain.id, `${module}/${action}`, params);

    const cached = this.cache.get<T>(cacheKey);
    if (cached !== null) return cached;

    await this.rateLimiter.acquire();

    const qs = new URLSearchParams(allParams).toString();
    const res = await fetch(`${this.chain.apiBaseUrl}?${qs}`);
    if (!res.ok) throw new Error(`Etherscan API error: ${res.status}`);

    const json: EtherscanResponse<T> = await res.json();
    if (json.status !== '1' && json.message !== 'No transactions found') {
      throw new Error(`Etherscan: ${json.message} (${json.result})`);
    }

    const result = json.status === '1' ? json.result : ([] as unknown as T);

    const ttl = action.includes('token') ? TOKEN_META_TTL : TX_CACHE_TTL;
    this.cache.set(cacheKey, result, ttl);

    return result;
  }

  async getTransactions(address: string, options?: FetchOptions): Promise<RawTransaction[]> {
    return this.fetchApi<RawTransaction[]>('account', 'txlist', {
      address,
      startblock: String(options?.startBlock ?? 0),
      endblock: String(options?.endBlock ?? 99999999),
      page: String(options?.page ?? 1),
      offset: String(options?.offset ?? 100),
      sort: options?.sort ?? 'desc',
    });
  }

  async getTokenTransfers(address: string, options?: FetchOptions): Promise<RawTokenTransfer[]> {
    return this.fetchApi<RawTokenTransfer[]>('account', 'tokentx', {
      address,
      startblock: String(options?.startBlock ?? 0),
      endblock: String(options?.endBlock ?? 99999999),
      page: String(options?.page ?? 1),
      offset: String(options?.offset ?? 100),
      sort: options?.sort ?? 'desc',
    });
  }

  async getTokenMetadata(_tokenAddress: string): Promise<TokenMetadata | null> {
    // Etherscan doesn't have a direct token metadata endpoint,
    // but we can get it from a token transfer response.
    // For now, return null — TokenResolver handles well-known tokens.
    return null;
  }
}
