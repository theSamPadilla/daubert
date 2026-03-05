export const ETHERSCAN_V2_BASE = 'https://api.etherscan.io/v2/api';

export interface ChainConfig {
  id: string;
  name: string;
  chainId: number;
  nativeCurrency: { symbol: string; decimals: number };
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

export interface RawTransactionDetail {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  blockNumber: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  contractAddress: string;
  tokenTransfers: RawTokenTransfer[];
}

export interface RawAddressInfo {
  address: string;
  addressType: 'wallet' | 'contract';
  balance: string;
  label?: string;
}

export interface TokenMetadata {
  address: string;
  symbol: string;
  decimals: number;
  name?: string;
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
