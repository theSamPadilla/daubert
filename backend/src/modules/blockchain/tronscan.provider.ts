import { BlockchainProvider } from './blockchain-provider';
import {
  RawTransaction,
  RawTokenTransfer,
  TokenMetadata,
  FetchOptions,
} from './types';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';

const TRONSCAN_BASE = 'https://apilist.tronscanapi.com/api';
const TX_CACHE_TTL = 60 * 60 * 1000; // 1hr
const TOKEN_CACHE_TTL = 24 * 60 * 60 * 1000; // 24hr

// Tronscan returns sun (1 TRX = 1_000_000 sun). We store raw amounts
// and let the frontend format with decimals, same as EVM chains.

interface TronscanTransfer {
  transactionHash: string;
  transferFromAddress: string;
  transferToAddress: string;
  amount: number; // in sun for TRX
  confirmed: boolean;
  block: number;
  timestamp: number;
  tokenInfo?: {
    tokenId: string;
    tokenAbbr: string;
    tokenName: string;
    tokenDecimal: number;
    tokenType: string;
  };
  contractRet?: string;
}

interface TronscanTrc20Transfer {
  transaction_id: string;
  from_address: string;
  to_address: string;
  quant: string; // raw amount string
  block_ts: number;
  block: number;
  confirmed: boolean;
  contractRet?: string;
  tokenInfo?: {
    tokenId: string;
    tokenAbbr: string;
    tokenName: string;
    tokenDecimal: number;
    tokenType: string;
  };
}

export class TronscanProvider implements BlockchainProvider {
  constructor(
    private apiKey: string,
    private rateLimiter: RateLimiter,
    private cache: ResponseCache,
  ) {}

  private async fetchApi<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const cacheKey = this.cache.buildKey('tron', path, params);
    const cached = this.cache.get<T>(cacheKey);
    if (cached !== null) return cached;

    await this.rateLimiter.acquire();

    const qs = new URLSearchParams(params).toString();
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['TRON-PRO-API-KEY'] = this.apiKey;
    }

    const res = await fetch(`${TRONSCAN_BASE}/${path}?${qs}`, { headers });
    if (!res.ok) throw new Error(`Tronscan API error: ${res.status}`);

    const data = await res.json();
    return data as T;
  }

  async getTransactions(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTransaction[]> {
    const limit = String(options?.offset ?? 50);
    const start = String(((options?.page ?? 1) - 1) * Number(limit));

    interface TransferResponse {
      data: TronscanTransfer[];
    }

    const data = await this.fetchApi<TransferResponse>('transfer', {
      address,
      start,
      limit,
      sort: options?.sort === 'asc' ? 'timestamp' : '-timestamp',
    });

    this.cache.set(
      this.cache.buildKey('tron', 'transfer', { address, start, limit }),
      data,
      TX_CACHE_TTL,
    );

    return (data.data || [])
      .filter((tx) => tx.contractRet !== 'REVERT')
      .map((tx) => ({
        hash: tx.transactionHash,
        from: tx.transferFromAddress,
        to: tx.transferToAddress,
        value: String(tx.amount),
        timeStamp: String(Math.floor(tx.timestamp / 1000)),
        blockNumber: String(tx.block),
        gas: '0',
        gasPrice: '0',
        gasUsed: '0',
        isError: tx.confirmed ? '0' : '0',
        input: '',
        contractAddress: '',
        nonce: '0',
      }));
  }

  async getTokenTransfers(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTokenTransfer[]> {
    const limit = String(options?.offset ?? 50);
    const start = String(((options?.page ?? 1) - 1) * Number(limit));

    interface Trc20Response {
      token_transfers: TronscanTrc20Transfer[];
    }

    const data = await this.fetchApi<Trc20Response>(
      'token_trc20/transfers',
      {
        relatedAddress: address,
        start,
        limit,
        sort: options?.sort === 'asc' ? 'timestamp' : '-timestamp',
      },
    );

    this.cache.set(
      this.cache.buildKey('tron', 'token_trc20/transfers', {
        relatedAddress: address,
        start,
        limit,
      }),
      data,
      TOKEN_CACHE_TTL,
    );

    return (data.token_transfers || [])
      .filter((tx) => tx.contractRet !== 'REVERT')
      .map((tx) => ({
        hash: tx.transaction_id,
        from: tx.from_address,
        to: tx.to_address,
        value: tx.quant,
        tokenName: tx.tokenInfo?.tokenName || '',
        tokenSymbol: tx.tokenInfo?.tokenAbbr || '',
        tokenDecimal: String(tx.tokenInfo?.tokenDecimal ?? 0),
        contractAddress: tx.tokenInfo?.tokenId || '',
        timeStamp: String(Math.floor(tx.block_ts / 1000)),
        blockNumber: String(tx.block),
        gas: '0',
        gasPrice: '0',
        gasUsed: '0',
        nonce: '0',
      }));
  }

  async getTokenMetadata(
    _tokenAddress: string,
  ): Promise<TokenMetadata | null> {
    return null;
  }
}
