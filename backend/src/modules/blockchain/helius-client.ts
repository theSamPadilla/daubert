import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';

const DEFAULT_HOST = 'https://mainnet.helius-rpc.com';

const RETRY_BACKOFF_MS = 600;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
// Helius's documented cap on ids per getAssetBatch RPC call.
const MAX_BATCH_IDS = 1000;

// Solana's account model has no equivalent of BTC's immutable-once-confirmed
// mempool/chain split, but recent history can still grow between calls, so
// it gets a short TTL. Parsed transactions and mint metadata are immutable
// once resolved and get longer TTLs.
const HISTORY_CACHE_TTL = 60 * 1000; // 1min
const TX_CACHE_TTL = 60 * 60 * 1000; // 1hr
const MINT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24hr

export interface HeliusNativeTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  amount: number; // lamports
}

export interface HeliusTokenTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  fromTokenAccount: string | null;
  toTokenAccount: string | null;
  mint: string;
  tokenAmount: number; // decimal-adjusted
  tokenStandard?: string;
}

export interface HeliusParsedTx {
  signature: string;
  timestamp: number;
  slot: number;
  fee: number;
  feePayer: string;
  type: string;
  source: string;
  description?: string;
  nativeTransfers: HeliusNativeTransfer[];
  tokenTransfers: HeliusTokenTransfer[];
  transactionError: unknown | null;
}

export interface MintMetadata {
  mint: string;
  symbol: string;
  decimals: number;
  /**
   * True when the DAS asset had usable `token_info` for this mint; false
   * when no asset (or one lacking `token_info`) was returned and `symbol`/
   * `decimals` are the truncated-mint fallback. Callers that need to
   * distinguish "genuinely unknown to Helius" from "resolved, ordinary
   * token" (e.g. the unknown-mint spam heuristic) must check this instead
   * of merely whether a map entry exists — every requested mint gets an
   * entry either way.
   */
  resolved: boolean;
}

interface HeliusAssetTokenInfo {
  symbol?: string;
  decimals?: number;
}

interface HeliusAsset {
  id: string;
  token_info?: HeliusAssetTokenInfo;
}

interface HeliusRpcResponse<T> {
  jsonrpc: string;
  result: T;
  id: string;
}

export class HeliusClient {
  constructor(
    private apiKey: string,
    private host: string = DEFAULT_HOST,
    // Own limiter + cache instances (Esplora precedent) — never share the
    // registry's EVM/Tron cache. Helius's free-tier Enhanced Transactions
    // limit is exactly 2 req/s, tighter than Esplora's (3,3).
    private rateLimiter: RateLimiter = new RateLimiter(2, 2),
    private cache: ResponseCache = new ResponseCache(),
  ) {}

  /** Waits `ms` before a 429 retry. Isolated so tests can stub it out. */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Appends `api-key` to `params` and builds the full request URL. The
   * caller-supplied `params` (used for the cache key) must never include
   * the api key itself.
   */
  private buildUrl(path: string, params: Record<string, string> = {}): string {
    const query = new URLSearchParams({ ...params, 'api-key': this.apiKey });
    return `${this.host}${path}?${query.toString()}`;
  }

  /**
   * Performs a single rate-limited fetch. On HTTP 429, waits and retries
   * once; any other non-OK status (on either attempt) throws immediately.
   * The error message carries only the status — never the URL, which
   * contains the api key.
   */
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    await this.rateLimiter.acquire();
    let res = await fetch(url, init);

    if (res.status === 429) {
      await this.wait(RETRY_BACKOFF_MS);
      await this.rateLimiter.acquire();
      res = await fetch(url, init);
    }

    if (!res.ok) {
      throw new Error(`Helius API error: ${res.status}`);
    }

    return (await res.json()) as T;
  }

  /** GET `path` with caching keyed on `params` (never the api key). */
  private async fetchApi<T>(
    path: string,
    params: Record<string, string>,
    cacheTtlMs: number,
  ): Promise<T> {
    const cacheKey = this.cache.buildKey('solana', path, params);
    const cached = this.cache.get<T>(cacheKey);
    if (cached !== null) return cached;

    const data = await this.request<T>(this.buildUrl(path, params));
    this.cache.set(cacheKey, data, cacheTtlMs);
    return data;
  }

  async addressTransactions(
    address: string,
    opts?: { beforeSignature?: string; limit?: number },
  ): Promise<HeliusParsedTx[]> {
    const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const params: Record<string, string> = { limit: String(limit) };
    if (opts?.beforeSignature) {
      params['before-signature'] = opts.beforeSignature;
    }

    return this.fetchApi<HeliusParsedTx[]>(
      `/v0/addresses/${encodeURIComponent(address)}/transactions`,
      params,
      HISTORY_CACHE_TTL,
    );
  }

  async parseTransaction(signature: string): Promise<HeliusParsedTx> {
    const cacheKey = this.cache.buildKey('solana', '/v0/transactions', { signature });
    const cached = this.cache.get<HeliusParsedTx>(cacheKey);
    if (cached !== null) return cached;

    const url = this.buildUrl('/v0/transactions');
    const data = await this.request<HeliusParsedTx[]>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [signature] }),
    });

    if (data.length === 0) {
      throw new Error('Helius API error: empty response for transaction');
    }

    const tx = data[0];
    this.cache.set(cacheKey, tx, TX_CACHE_TTL);
    return tx;
  }

  async getMintMetadata(mints: string[]): Promise<Map<string, MintMetadata>> {
    const result = new Map<string, MintMetadata>();
    const uncached: string[] = [];

    for (const mint of mints) {
      const cacheKey = this.cache.buildKey('solana', '/getAsset', { mint });
      const cached = this.cache.get<MintMetadata>(cacheKey);
      if (cached !== null) {
        result.set(mint, cached);
      } else {
        uncached.push(mint);
      }
    }

    // Helius caps getAssetBatch at MAX_BATCH_IDS ids per call — chunk rather
    // than risk a rejected (or silently truncated) oversized request.
    for (let i = 0; i < uncached.length; i += MAX_BATCH_IDS) {
      const chunk = uncached.slice(i, i + MAX_BATCH_IDS);
      const url = this.buildUrl('/');
      const response = await this.request<HeliusRpcResponse<(HeliusAsset | null)[]>>(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            method: 'getAssetBatch',
            params: { ids: chunk },
          }),
        },
      );

      // Keyed by asset id, never by response position: getAssetBatch is not
      // guaranteed to return assets in request order.
      const assetsById = new Map<string, HeliusAsset>();
      for (const asset of response.result ?? []) {
        if (asset) assetsById.set(asset.id, asset);
      }

      chunk.forEach((mint) => {
        const tokenInfo = assetsById.get(mint)?.token_info;
        const metadata: MintMetadata = tokenInfo
          ? {
              mint,
              symbol: tokenInfo.symbol ?? `${mint.slice(0, 4)}…`,
              decimals: tokenInfo.decimals ?? 0,
              resolved: true,
            }
          : { mint, symbol: `${mint.slice(0, 4)}…`, decimals: 0, resolved: false };

        const cacheKey = this.cache.buildKey('solana', '/getAsset', { mint });
        this.cache.set(cacheKey, metadata, MINT_CACHE_TTL);
        result.set(mint, metadata);
      });
    }

    return result;
  }

  async getBalance(address: string): Promise<string> {
    const url = this.buildUrl('/');
    const response = await this.request<
      HeliusRpcResponse<{ context: unknown; value: number }>
    >(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getBalance',
        params: [address],
      }),
    });

    return String(response.result.value);
  }
}
