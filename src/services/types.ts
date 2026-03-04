export interface ChainConfig {
  id: string;
  name: string;
  nativeCurrency: { symbol: string; decimals: number };
  apiBaseUrl: string;
  apiKeyEnvVar: string;
  explorerUrl: string;
}

export interface RawTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  blockNumber: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  isError: string;
  input: string;
  contractAddress: string;
  nonce: string;
}

export interface RawTokenTransfer {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
  timeStamp: string;
  blockNumber: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  nonce: string;
}

export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
}

export interface PriceData {
  usd: number;
  timestamp: string;
}

export interface FetchOptions {
  startBlock?: number;
  endBlock?: number;
  page?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    apiBaseUrl: 'https://api.etherscan.io/api',
    apiKeyEnvVar: 'VITE_ETHERSCAN_API_KEY',
    explorerUrl: 'https://etherscan.io',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    nativeCurrency: { symbol: 'MATIC', decimals: 18 },
    apiBaseUrl: 'https://api.polygonscan.com/api',
    apiKeyEnvVar: 'VITE_POLYGONSCAN_API_KEY',
    explorerUrl: 'https://polygonscan.com',
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    apiBaseUrl: 'https://api.arbiscan.io/api',
    apiKeyEnvVar: 'VITE_ARBISCAN_API_KEY',
    explorerUrl: 'https://arbiscan.io',
  },
  base: {
    id: 'base',
    name: 'Base',
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    apiBaseUrl: 'https://api.basescan.org/api',
    apiKeyEnvVar: 'VITE_BASESCAN_API_KEY',
    explorerUrl: 'https://basescan.org',
  },
};
