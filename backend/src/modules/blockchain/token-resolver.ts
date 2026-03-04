import { TokenMetadata } from './types';
import { BlockchainProvider } from './blockchain-provider';

const WELL_KNOWN: Record<string, Record<string, TokenMetadata>> = {
  ethereum: {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { address: '0x6b175474e89094c44da98b954eedeac495271d0f', symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', symbol: 'WBTC', decimals: 8, name: 'Wrapped BTC' },
  },
  polygon: {
    '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': { address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': { address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': { address: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': { address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
    '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': { address: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', symbol: 'WBTC', decimals: 8, name: 'Wrapped BTC' },
  },
  arbitrum: {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
    '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': { address: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', symbol: 'WBTC', decimals: 8, name: 'Wrapped BTC' },
  },
  base: {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    '0x4200000000000000000000000000000000000006': { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb', symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
  },
  tron: {
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8': { address: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9': { address: 'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9', symbol: 'BTC', decimals: 8, name: 'Bitcoin (TRC20)' },
    'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR': { address: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', symbol: 'WTRX', decimals: 6, name: 'Wrapped TRX' },
  },
};

export class TokenResolver {
  private memoryCache = new Map<string, TokenMetadata>();

  resolve(chain: string, tokenAddress: string): TokenMetadata | null {
    const addr = tokenAddress.toLowerCase();
    const memKey = `${chain}:${addr}`;

    const cached = this.memoryCache.get(memKey);
    if (cached) return cached;

    const wellKnown = WELL_KNOWN[chain]?.[addr];
    if (wellKnown) {
      this.memoryCache.set(memKey, wellKnown);
      return wellKnown;
    }

    return null;
  }

  async resolveAsync(
    chain: string,
    tokenAddress: string,
    provider: BlockchainProvider,
  ): Promise<TokenMetadata | null> {
    const immediate = this.resolve(chain, tokenAddress);
    if (immediate) return immediate;

    const result = await provider.getTokenMetadata(tokenAddress);
    if (result) {
      this.memoryCache.set(
        `${chain}:${tokenAddress.toLowerCase()}`,
        result,
      );
    }
    return result;
  }

  resolveFromTransfer(
    chain: string,
    contractAddress: string,
    symbol: string,
    decimals: number,
  ): TokenMetadata {
    const addr = contractAddress.toLowerCase();
    const memKey = `${chain}:${addr}`;

    const cached = this.memoryCache.get(memKey);
    if (cached) return cached;

    const meta: TokenMetadata = { address: addr, symbol, decimals };
    this.memoryCache.set(memKey, meta);
    return meta;
  }
}
