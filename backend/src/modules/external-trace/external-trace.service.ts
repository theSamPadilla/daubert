import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BlockchainService, TransactionResult } from '../blockchain/blockchain.service';
import { LabeledEntitiesService } from '../labeled-entities/labeled-entities.service';
import { buildGraph, GraphResult } from './graph-builder';
import { normalizeAddressForChain, validateAddressForChain } from '../../generated/shared/address';
import { edgeIdentityKey } from '../../generated/shared/edge-identity';
import { usesCursorPagination } from '../../generated/shared/chains';

// Per-direction cap: 5 incoming + 5 outgoing per address (root and hop-2 alike).
// The previous flat 10-tx cap let one direction dominate when an address skewed
// heavily inbound or outbound, making graphs read as one-sided. Splitting
// keeps both flows visible and bounds the rendered node count tightly.
const PER_DIRECTION_LIMIT = 5;
// We fetch a larger window from the provider, then partition + trim, because
// Etherscan/Tronscan don't expose a direction filter. 40 is enough to find
// both directions for nearly any active address.
const FETCH_WINDOW = 40;
const HOP_2_FANOUT = 5;
const NODE_CAP = 100;
const EDGE_CAP = 200;

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

const HOP_2_CONCURRENCY = 2;

export interface TraceResponse extends GraphResult {
  root: string;
  chain: string;
  hops: number;
  cachedAt: string; // ISO timestamp set at generation; preserved across cache hits
}

interface CacheEntry {
  result: TraceResponse;
  expiresAt: number;
}

@Injectable()
export class ExternalTraceService {
  private readonly logger = new Logger(ExternalTraceService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private hop2InFlight = 0;
  private readonly hop2Waiters: Array<() => void> = [];

  constructor(
    private readonly blockchain: BlockchainService,
    private readonly labels: LabeledEntitiesService,
  ) {}

  async trace(rawAddress: string, chain: string, hopsIn: number): Promise<TraceResponse> {
    const hops = hopsIn === 2 ? 2 : 1; // clamp; DTO bounds it but defense in depth
    const address = this.normalizeAddress(rawAddress, chain);
    this.validateAddressChain(address, chain);

    // Cache key MUST include every input that affects the response shape.
    // If you add a new query parameter (e.g. `since`, `tokenFilter`),
    // append it here or callers will see stale results.
    const cacheKey = `${chain}:${address}:${hops}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.result;
    }

    const allTxs: TransactionResult[] = [];

    // Hop 1: fetch a window, partition by direction relative to `address`,
    // keep up to PER_DIRECTION_LIMIT of each.
    const rootHistory = await this.blockchain.fetchHistory(
      address,
      chain,
      this.fetchWindowOptions(chain),
    );
    const rootTrimmed = this.trimByDirection(rootHistory.transactions, address);
    allTxs.push(...rootTrimmed);

    // Hop 2 (parallelized, capped). Counterparty ranking uses the trimmed
    // root window so direction balance carries through to hop-2 fan-out.
    if (hops === 2) {
      const counterCounts = new Map<string, number>();
      for (const tx of rootTrimmed) {
        // BTC junction rows (coinjoin/consolidation/coinbase/wide fan-out)
        // draw the transaction as an unattributed junction node, not an
        // address edge -- the graph never connects `address` to a single
        // counterparty for these rows, so hop-2 must not rank one either.
        // Junction rows come in TWO shapes: incoming (`from: ''`, `to` =
        // traced address) and outgoing (`from` = traced address, `to` = a
        // real counterparty address). Only `utxo.junction === true`
        // reliably flags both -- keying off `!tx.from` alone would miss
        // the outgoing shape and rank a counterparty the canvas never draws.
        if (tx.chain === 'bitcoin' && tx.utxo?.junction) continue;

        // tx.from/tx.to are already chain-normalized by BlockchainService.fetchHistory
        // (lowercased for EVM, base58 preserved for Tron). The same normalization
        // produced `address` above, so equality holds without further transform.
        const other = tx.from === address ? tx.to : tx.from;
        if (!other || other === address) continue;
        // Defensive, belt-and-braces: never rank/fetch something that isn't
        // a real address for this chain (e.g. a stray txid) as a hop-2
        // counterparty.
        if (!tx.from || validateAddressForChain(other, chain) != null) continue;
        counterCounts.set(other, (counterCounts.get(other) ?? 0) + 1);
      }
      const topCps = [...counterCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, HOP_2_FANOUT)
        .map(([addr]) => addr);

      const hop2Results = await Promise.all(
        topCps.map((cp) =>
          this.withHop2Slot(() =>
            this.blockchain.fetchHistory(cp, chain, this.fetchWindowOptions(chain)),
          )
            .then((r) => ({ cp, transactions: r.transactions }))
            .catch((err) => {
              this.logger.warn(`hop-2 fetch failed for ${cp}: ${err.message}`);
              return null;
            }),
        ),
      );

      for (const r of hop2Results) {
        if (!r) continue;
        allTxs.push(...this.trimByDirection(r.transactions, r.cp));
      }
    }

    const graph = buildGraph(allTxs, address, {
      nodeCap: NODE_CAP,
      edgeCap: EDGE_CAP,
    });

    // Batch label lookup: one SQL round-trip for every node in the graph.
    const addresses = graph.nodes.map((n) => n.address);
    const labelMap = await this.labels.lookupByAddresses(addresses);
    for (const node of graph.nodes) {
      const entities = labelMap.get(node.address.toLowerCase());
      if (entities && entities.length > 0) {
        node.label = { name: entities[0].name, category: entities[0].category };
      }
    }

    const result: TraceResponse = {
      root: address,
      chain,
      hops,
      ...graph,
      cachedAt: new Date().toISOString(),
    };

    this.putCache(cacheKey, this.deepFreeze(result));
    return result;
  }

  private putCache(key: string, result: TraceResponse) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Simple LRU-ish: drop oldest insertion. Map iteration order = insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  // EVM/Tron read `offset` as the page size. Cursor-paginated chains
  // (bitcoin, solana) ignore `offset` entirely and bound their paging with
  // `maxTotal`. Setting `maxTotal` on the account-model path would flip
  // fetchHistory into its paginated branch, which caps the MERGED
  // native+token list at FETCH_WINDOW rows instead of FETCH_WINDOW per
  // source -- a narrower window than the widget has today.
  private fetchWindowOptions(chain: string) {
    return usesCursorPagination(chain)
      ? { offset: FETCH_WINDOW, maxTotal: FETCH_WINDOW }
      : { offset: FETCH_WINDOW };
  }

  private deepFreeze<T>(obj: T): T {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.freeze(obj);
      for (const key of Object.keys(obj)) {
        this.deepFreeze((obj as any)[key]);
      }
    }
    return obj;
  }

  /**
   * Keep the top PER_DIRECTION_LIMIT incoming and outgoing transactions
   * for `address`, deduped by txHash. Input is assumed already sorted by
   * timestamp desc (BlockchainService.fetchHistory does this).
   */
  private trimByDirection(
    txs: TransactionResult[],
    address: string,
  ): TransactionResult[] {
    const incoming: TransactionResult[] = [];
    const outgoing: TransactionResult[] = [];
    const seen = new Set<string>();
    for (const tx of txs) {
      // Solana spam rows (suspected unsolicited/airdrop transfers) stay on
      // the product canvas -- default-unchecked in staging, since they're a
      // real ledger fact an investigator may want to see -- but this public
      // widget only shows counterparty flows, so suspected spam is excluded
      // outright.
      if (tx.chain === 'solana' && tx.solana?.spam === true) continue;

      // BTC self/change rows (from === to) are noise at a 5-per-direction
      // cap: the product canvas keeps them (they're a real ledger fact),
      // but this widget only shows counterparty flows, so they're dropped
      // here rather than upstream.
      if (tx.chain === 'bitcoin' && tx.from === tx.to) continue;

      // BTC rows carry `utxo.vout`, so one txid's several outputs to
      // different counterparties each get their own dedup slot instead of
      // collapsing onto a single bare `txHash` key like account-model chains.
      // Solana rows carry `solana.transferIndex`, so several transfers inside
      // one signature (e.g. a native SOL leg + an SPL leg) each get their own
      // dedup slot (`${txHash}:sol:${transferIndex}`) instead of collapsing
      // onto the bare signature.
      const key =
        tx.chain === 'bitcoin' || tx.chain === 'solana'
          ? edgeIdentityKey(tx, tx.from, tx.to)
          : tx.txHash;
      if (seen.has(key)) continue;
      if (tx.to === address && incoming.length < PER_DIRECTION_LIMIT) {
        incoming.push(tx);
        seen.add(key);
      } else if (tx.from === address && outgoing.length < PER_DIRECTION_LIMIT) {
        outgoing.push(tx);
        seen.add(key);
      }
      if (
        incoming.length >= PER_DIRECTION_LIMIT &&
        outgoing.length >= PER_DIRECTION_LIMIT
      ) {
        break;
      }
    }
    return [...incoming, ...outgoing];
  }

  /** Minimal counting semaphore. Resolves when a slot is available. */
  private async withHop2Slot<T>(work: () => Promise<T>): Promise<T> {
    while (this.hop2InFlight >= HOP_2_CONCURRENCY) {
      await new Promise<void>((resolve) => this.hop2Waiters.push(resolve));
    }
    this.hop2InFlight += 1;
    try {
      return await work();
    } finally {
      this.hop2InFlight -= 1;
      const next = this.hop2Waiters.shift();
      if (next) next();
    }
  }

  private normalizeAddress(addr: string, chain: string): string {
    return normalizeAddressForChain(addr, chain);
  }

  private validateAddressChain(addr: string, chain: string): void {
    const err = validateAddressForChain(addr, chain);
    if (err) throw new BadRequestException(err);
  }
}
