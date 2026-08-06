import { Logger } from '@nestjs/common';
import { HeliusClient, HeliusParsedTx, MintMetadata } from './helius-client';
import { RawAddressInfo } from './types';
import { SolanaFetchOptions, SolanaProvider } from './solana-provider';

const DEFAULT_MAX_TOTAL = 100;
const HARD_CAP_MAX_TOTAL = 1000;
// Request Helius's own maximum page size (see MAX_LIMIT in helius-client.ts)
// to minimize round trips against its 2 req/s rate limit.
const PAGE_LIMIT = 100;
// Bounds the walk for the case where startTimestamp is far in the past and
// every page happens to be full-sized (mirrors BitcoinProvider's MAX_PAGES).
const MAX_PAGES = 200;

/**
 * Account-model provider for Solana, backed by Helius. Deliberately does NOT
 * implement the page-number account-model BlockchainProvider — Helius's
 * history endpoint is cursor-based (signature), not page/offset-based — so
 * it is served through ProviderRegistry.getSolana() instead of get().
 */
export class HeliusProvider implements SolanaProvider {
  private readonly logger = new Logger(HeliusProvider.name);

  constructor(private client: HeliusClient) {}

  async getAddressHistory(
    address: string,
    options: SolanaFetchOptions = {},
  ): Promise<{ txs: HeliusParsedTx[]; mintMeta: Map<string, MintMetadata> }> {
    const maxTotal = Math.min(
      options.maxTotal ?? DEFAULT_MAX_TOTAL,
      HARD_CAP_MAX_TOTAL,
    );
    const { startTimestamp, endTimestamp } = options;

    // No server-side date filter on Helius's history endpoint — filter
    // INSIDE the loop and count only KEPT rows toward maxTotal. Filtering
    // after accumulation would let a page entirely outside the window (e.g.
    // all newer than endTimestamp) trip a raw-count stop condition before
    // the walk ever reaches txs inside the window, producing a false-empty
    // result (mirrors BitcoinProvider's getAddressHistory).
    const inWindow = (tx: HeliusParsedTx) => {
      if (startTimestamp != null && tx.timestamp < startTimestamp) return false;
      if (endTimestamp != null && tx.timestamp > endTimestamp) return false;
      return true;
    };

    const kept: HeliusParsedTx[] = [];
    let beforeSignature: string | undefined;

    for (let pages = 0; pages < MAX_PAGES; pages++) {
      let page: HeliusParsedTx[];
      try {
        page = await this.client.addressTransactions(address, {
          beforeSignature,
          limit: PAGE_LIMIT,
        });
      } catch (err) {
        this.logger.warn(
          `addressTransactions failed for ${address} (before=${beforeSignature ?? 'start'}): ${(err as Error).message}. Returning ${kept.length} accumulated so far.`,
        );
        break;
      }

      if (page.length === 0) break;

      beforeSignature = page[page.length - 1].signature;
      kept.push(...page.filter(inWindow));

      const partialPage = page.length < PAGE_LIMIT;
      const allOlderThanStart =
        startTimestamp != null &&
        page.every((tx) => tx.timestamp < startTimestamp);

      if (partialPage || allOlderThanStart || kept.length >= maxTotal) {
        break;
      }
    }

    const txs = kept.slice(0, maxTotal);

    // Batch-resolve mint metadata once per fetch, across only the KEPT txs,
    // so the (later) normalizer receives it pre-attached and stays pure.
    const mints = new Set<string>();
    for (const tx of txs) {
      for (const transfer of tx.tokenTransfers) {
        mints.add(transfer.mint);
      }
    }
    const mintMeta = await this.client.getMintMetadata([...mints]);

    return { txs, mintMeta };
  }

  async getTx(
    signature: string,
  ): Promise<{ tx: HeliusParsedTx; mintMeta: Map<string, MintMetadata> }> {
    const tx = await this.client.parseTransaction(signature);
    const mints = [...new Set(tx.tokenTransfers.map((t) => t.mint))];
    const mintMeta = await this.client.getMintMetadata(mints);
    return { tx, mintMeta };
  }

  async getAddressInfo(address: string): Promise<RawAddressInfo> {
    const balance = await this.client.getBalance(address);
    return {
      address,
      addressType: 'wallet',
      balance,
    };
  }
}
