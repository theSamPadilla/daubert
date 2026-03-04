export interface ChainConfig {
  id: string;
  name: string;
  chainId: number;
  nativeCurrency: { symbol: string; decimals: number };
  explorerUrl: string;
}

export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://etherscan.io',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    nativeCurrency: { symbol: 'MATIC', decimals: 18 },
    explorerUrl: 'https://polygonscan.com',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    chainId: 42161,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://arbiscan.io',
  },
  base: {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    explorerUrl: 'https://basescan.org',
  },
  tron: {
    id: 'tron',
    name: 'Tron',
    chainId: 728126428,
    nativeCurrency: { symbol: 'TRX', decimals: 6 },
    explorerUrl: 'https://tronscan.org',
  },
};
