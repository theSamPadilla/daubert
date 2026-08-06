import { HeliusParsedTx, MintMetadata } from './helius-client';
import { RawAddressInfo } from './types';

export interface SolanaFetchOptions {
  maxTotal?: number;
  startTimestamp?: number;
  endTimestamp?: number;
}

/**
 * Cursor-paginated account-model seam for Solana, mirroring UtxoProvider's
 * role for Bitcoin. Solana's history endpoint is cursor-based (signature),
 * not page-number-based, so it can't be expressed through the account-model
 * BlockchainProvider contract (which assumes page/offset paging) — it is
 * served through ProviderRegistry.getSolana() instead.
 *
 * Unlike UtxoProvider's bare-array returns, getAddressHistory/getTx return a
 * { txs/tx, mintMeta } wrapper: mint metadata is resolved in a single batch
 * call per fetch and must travel alongside the txs so the (later) normalizer
 * stays pure rather than reaching back out to Helius per-mint.
 */
export interface SolanaProvider {
  getAddressHistory(
    address: string,
    options?: SolanaFetchOptions,
  ): Promise<{ txs: HeliusParsedTx[]; mintMeta: Map<string, MintMetadata> }>;
  getTx(
    signature: string,
  ): Promise<{ tx: HeliusParsedTx; mintMeta: Map<string, MintMetadata> }>;
  getAddressInfo(address: string): Promise<RawAddressInfo>;
}
