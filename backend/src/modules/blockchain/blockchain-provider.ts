import {
  RawTransaction,
  RawTokenTransfer,
  FetchOptions,
  RawTransactionDetail,
  RawAddressInfo,
} from './types';
import { ContractClassification } from './contract-classifier';

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
  /**
   * Classification only: no balance, no extra calls. `determined` is false when
   * the chain could not be asked, or when this provider cannot answer at all —
   * callers persist only determined results, so an unreachable probe leaves no
   * record rather than a fabricated one.
   */
  classifyAddress(
    address: string,
  ): Promise<{ classification: ContractClassification; determined: boolean }>;
}
