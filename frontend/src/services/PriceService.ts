import { RateLimiter } from './RateLimiter';
import { ResponseCache } from './ResponseCache';

// Stablecoin symbols that always return $1.00
const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDP', 'FRAX', 'LUSD', 'GUSD']);

// Token address → CoinGecko ID (lowercase addresses)
const TOKEN_TO_COINGECKO: Record<string, Record<string, string>> = {
  ethereum: {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'ethereum', // WETH
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'bitcoin', // WBTC
  },
  polygon: {
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'ethereum', // WETH
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 'bitcoin', // WBTC
  },
  arbitrum: {
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'ethereum', // WETH
    '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 'bitcoin', // WBTC
  },
  base: {
    '0x4200000000000000000000000000000000000006': 'ethereum', // WETH
  },
};

// Native currency → CoinGecko ID
const NATIVE_TO_COINGECKO: Record<string, string> = {
  ETH: 'ethereum',
  MATIC: 'matic-network',
};

const PRICE_TTL = 24 * 60 * 60 * 1000; // 24hr

export class PriceService {
  private rateLimiter = new RateLimiter(1, 0.5); // 0.5 req/sec for free tier
  private cache = new ResponseCache();

  async getHistoricalPrice(
    chain: string,
    tokenAddress: string,
    symbol: string,
    timestamp: string
  ): Promise<number | null> {
    // Stablecoins shortcircuit
    if (STABLECOINS.has(symbol.toUpperCase())) return 1.0;

    const date = new Date(timestamp);
    const dateStr = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;

    // Determine CoinGecko ID
    let geckoId: string | undefined;
    if (tokenAddress && tokenAddress !== '0x') {
      geckoId = TOKEN_TO_COINGECKO[chain]?.[tokenAddress.toLowerCase()];
    }
    if (!geckoId && symbol) {
      geckoId = NATIVE_TO_COINGECKO[symbol.toUpperCase()];
    }
    if (!geckoId) return null;

    // Check cache
    const cacheKey = this.cache.buildKey(chain, 'price', { id: geckoId, date: dateStr });
    const cached = this.cache.get<number>(cacheKey);
    if (cached !== null) return cached;

    // Fetch from CoinGecko
    try {
      await this.rateLimiter.acquire();
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${geckoId}/history?date=${dateStr}&localization=false`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.market_data?.current_price?.usd ?? null;
      if (price !== null) {
        this.cache.set(cacheKey, price, PRICE_TTL);
      }
      return price;
    } catch {
      return null;
    }
  }
}
