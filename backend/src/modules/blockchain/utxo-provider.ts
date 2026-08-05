import { EsploraTx } from './esplora-client';
import { RawAddressInfo } from './types';

export interface UtxoFetchOptions {
  maxTotal?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  includeMempool?: boolean;
}

export interface UtxoProvider {
  getAddressHistory(
    address: string,
    options?: UtxoFetchOptions,
  ): Promise<EsploraTx[]>;
  getTx(txid: string): Promise<EsploraTx>;
  getAddressInfo(address: string): Promise<RawAddressInfo>;
}
