import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';

const DEFAULT_HOSTS = [
  'https://mempool.space/api',
  'https://blockstream.info/api',
];

const CACHE_TTL = 60 * 60 * 1000; // 1hr

export interface EsploraVin {
  txid: string;
  vout: number;
  is_coinbase: boolean;
  prevout: {
    scriptpubkey_address?: string;
    scriptpubkey_type: string;
    value: number;
  } | null;
}

export interface EsploraVout {
  scriptpubkey_address?: string;
  scriptpubkey_type: string;
  value: number;
}

export interface EsploraTx {
  txid: string;
  fee: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export interface EsploraAddressStats {
  address: string;
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

export class EsploraClient {
  constructor(
    private hosts: string[] = DEFAULT_HOSTS,
    private rateLimiter: RateLimiter = new RateLimiter(3, 3),
    // Own limiter + cache instances, deliberately NOT the registry's shared
    // ones: BTC payloads are large and would evict the 200-slot shared cache.
    private cache: ResponseCache = new ResponseCache(),
  ) {}

  /**
   * Fetches `path` from host[0], failing over to host[1] once on network
   * error, 429, or any 5xx. Other 4xx statuses (400/404/...) are not
   * retried — they would fail identically on both hosts.
   */
  private async fetchApi<T>(
    path: string,
    params: Record<string, string> = {},
    cacheable = true,
  ): Promise<T> {
    const cacheKey = this.cache.buildKey('bitcoin', path, params);
    if (cacheable) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== null) return cached;
    }

    let lastError: string | null = null;

    for (let i = 0; i < this.hosts.length; i++) {
      const url = `${this.hosts[i]}${path}`;
      await this.rateLimiter.acquire();

      let res: Response;
      try {
        res = await fetch(url);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        continue; // network error: eligible for failover
      }

      if (res.ok) {
        const data = (await res.json()) as T;
        if (cacheable) this.cache.set(cacheKey, data, CACHE_TTL);
        return data;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        throw new Error(`Esplora API error: ${res.status}`);
      }
      lastError = String(res.status);
    }

    throw new Error(`Esplora API error: ${lastError}`);
  }

  async addressStats(address: string): Promise<EsploraAddressStats> {
    return this.fetchApi<EsploraAddressStats>(`/address/${encodeURIComponent(address)}`);
  }

  async confirmedTxs(
    address: string,
    lastSeenTxid?: string,
  ): Promise<EsploraTx[]> {
    const path = lastSeenTxid
      ? `/address/${encodeURIComponent(address)}/txs/chain/${encodeURIComponent(lastSeenTxid)}`
      : `/address/${encodeURIComponent(address)}/txs/chain`;
    return this.fetchApi<EsploraTx[]>(
      path,
      lastSeenTxid ? { lastSeenTxid } : {},
    );
  }

  async mempoolTxs(address: string): Promise<EsploraTx[]> {
    // Mempool contents change constantly; caching them would serve stale
    // unconfirmed transactions, so this call is never cached.
    return this.fetchApi<EsploraTx[]>(
      `/address/${encodeURIComponent(address)}/txs/mempool`,
      {},
      false,
    );
  }

  async tx(txid: string): Promise<EsploraTx> {
    return this.fetchApi<EsploraTx>(`/tx/${encodeURIComponent(txid)}`);
  }
}
