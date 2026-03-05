import {
  RawTransaction,
  RawTokenTransfer,
  FetchOptions,
  RawTransactionDetail,
  RawAddressInfo,
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
  getTransaction(txHash: string): Promise<RawTransactionDetail>;
  getAddressInfo(address: string): Promise<RawAddressInfo>;
}
