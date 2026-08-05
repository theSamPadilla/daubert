import { Logger } from '@nestjs/common';
import { EsploraClient, EsploraTx } from './esplora-client';
import { RawAddressInfo } from './types';
import { UtxoFetchOptions, UtxoProvider } from './utxo-provider';

const PAGE_SIZE = 25;
const DEFAULT_MAX_TOTAL = 100;
const HARD_CAP_MAX_TOTAL = 1000;

/**
 * UTXO-model provider for Bitcoin, backed by an Esplora-compatible API
 * (mempool.space / blockstream.info). Deliberately does NOT implement the
 * account-model BlockchainProvider — Bitcoin has no concept of an
 * account-scoped transaction list or token transfers, so it is served
 * through ProviderRegistry.getUtxo() instead of the EVM/Tron get() path.
 */
export class BitcoinProvider implements UtxoProvider {
  private readonly logger = new Logger(BitcoinProvider.name);

  constructor(private client: EsploraClient = new EsploraClient()) {}

  async getAddressHistory(
    address: string,
    options: UtxoFetchOptions = {},
  ): Promise<EsploraTx[]> {
    const maxTotal = Math.min(
      options.maxTotal ?? DEFAULT_MAX_TOTAL,
      HARD_CAP_MAX_TOTAL,
    );
    const includeMempool = options.includeMempool !== false;
    const { startTimestamp, endTimestamp } = options;

    let mempoolTxs: EsploraTx[] = [];
    if (includeMempool) {
      try {
        mempoolTxs = await this.client.mempoolTxs(address);
      } catch (err) {
        this.logger.warn(
          `mempoolTxs failed for ${address}: ${(err as Error).message}. Continuing without mempool txs.`,
        );
      }
    }

    // Mempool txs have no block_time; treat them as happening "now".
    const inWindow = (tx: EsploraTx) => {
      const t = tx.status.block_time ?? Math.floor(Date.now() / 1000);
      if (startTimestamp != null && t < startTimestamp) return false;
      if (endTimestamp != null && t > endTimestamp) return false;
      return true;
    };

    // Filter INSIDE the loop and count only KEPT rows toward maxTotal.
    // Filtering after accumulation would let a page of txs outside the
    // window (e.g. all newer than endTimestamp) trip the `confirmed.length
    // >= maxTotal` stop condition before the walk ever reaches txs inside
    // the window, producing a false-empty result. MAX_PAGES bounds the walk
    // for the case where endTimestamp is far in the past.
    const kept: EsploraTx[] = [];
    let cursor: string | undefined;
    const MAX_PAGES = 200;

    for (let pages = 0; pages < MAX_PAGES; pages++) {
      let page: EsploraTx[];
      try {
        page = await this.client.confirmedTxs(address, cursor);
      } catch (err) {
        this.logger.warn(
          `confirmedTxs failed for ${address} (cursor=${cursor ?? 'start'}): ${(err as Error).message}. Returning ${kept.length} accumulated so far.`,
        );
        break;
      }

      if (page.length === 0) break;

      cursor = page[page.length - 1].txid;
      kept.push(...page.filter(inWindow));

      const partialPage = page.length < PAGE_SIZE;
      const allOlderThanStart =
        startTimestamp != null &&
        page.every(
          (tx) => (tx.status.block_time ?? Infinity) < startTimestamp,
        );

      if (partialPage || allOlderThanStart || kept.length >= maxTotal) {
        break;
      }
    }

    const combined: EsploraTx[] = [...mempoolTxs.filter(inWindow), ...kept];

    return combined.slice(0, maxTotal);
  }

  async getTx(txid: string): Promise<EsploraTx> {
    return this.client.tx(txid);
  }

  async getAddressInfo(address: string): Promise<RawAddressInfo> {
    const stats = await this.client.addressStats(address);
    const balance =
      stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
    return {
      address,
      addressType: 'wallet',
      balance: String(balance),
    };
  }
}
