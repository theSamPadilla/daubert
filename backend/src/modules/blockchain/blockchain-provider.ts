import {
  RawTransaction,
  RawTokenTransfer,
  TokenMetadata,
  FetchOptions,
} from './types';

export interface BlockchainProvider {
  getTransactions(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTransaction[]>;
  getTokenTransfers(
    address: string,
    options?: FetchOptions,
  ): Promise<RawTokenTransfer[]>;
  getTokenMetadata(tokenAddress: string): Promise<TokenMetadata | null>;
}
