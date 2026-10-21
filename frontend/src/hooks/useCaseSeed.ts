import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { parseTimestamp } from '@/utils/formatAmount';
import type { components } from '@/generated/api-types';
import { edgeIdentityKey } from '../generated/shared/edge-identity';
import { usesCursorPagination } from '../generated/shared/chains';
import { selectPrimaryTransfer } from '@/utils/selectPrimaryTransfer';

type ImportItem = components['schemas']['ImportTransactionItem'];
type TransactionDetail = components['schemas']['TransactionDetailResult'];

/** What the seed step was given: wallets to pull recent activity for, and exact transactions. */
export interface SeedInputs {
  addresses: string[];
  txHashes: string[];
}

/** Per-address fetch cap, most recent first. */
export const SEED_TX_LIMIT = 100;

/** Thrown when no address in the batch yields any transaction. */
export class SeedEmptyError extends Error {}

export interface SeedAddressError {
  address: string;
  message: string;
}

export interface SeedResult {
  investigationId: string;
  traceId: string;
  nodeCount: number;
  edgeCount: number;
  txCount: number;
  errors: SeedAddressError[];
}

export type SeedPhase = 'idle' | 'fetching' | 'creating' | 'importing' | 'done' | 'error';

/**
 * Shape of a single item returned by `apiClient.fetchHistory`. Mirrors the
 * backend `TransactionResult` (backend/src/modules/blockchain/blockchain.service.ts:7-24).
 * `token` is an object there, unlike `ImportTransactionItem.token` (a string).
 * We accept `token` as `object | string` for robustness against callers (e.g.
 * AI scripts) that already pass a plain symbol string. `address`/`decimals`
 * on the object form are what let `mapFetchedTx` populate `tokenMeta` below —
 * without them, an EVM/Tron token collapses to a bare symbol and the
 * importer can't rebuild decimals (see traces.service.ts `evmToken()`).
 */
interface FetchedTx {
  from: string;
  to: string;
  txHash: string;
  chain?: string;
  timestamp: string | number;
  amount: string;
  token: { symbol?: string; address?: string; decimals?: number } | string;
  blockNumber?: number;
  fromLabel?: string;
  toLabel?: string;
  /** UTXO provenance (Bitcoin only) — carried through verbatim to the import item. */
  utxo?: ImportItem['utxo'];
  /** Per-transfer provenance (Solana only) — carried through verbatim to the import item. */
  solana?: ImportItem['solana'];
}

/**
 * Truncate a hex address for display: `0x1234…5678`. Addresses of 10 chars or
 * fewer pass through unchanged. Matches the `${first6}…${last4}` convention used
 * across the graph components (e.g. FetchModal, SearchResults, focusItem).
 */
export function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Map a fetched transaction to an `ImportTransactionItem`. Collapses the
 * `token` object to its `symbol` string (the backend DTO requires a string —
 * passing the object 400s), and normalizes the timestamp to an ISO string so it
 * satisfies the `date-time` format regardless of whether the provider returned
 * ISO or unix-seconds. `utxo` (Bitcoin only) is carried through verbatim — it
 * is what lets a junction-flagged row be recognized and replanned client-side
 * (see `planJunction` / `useWalletTransactionAuthoring`). `solana` (Solana
 * only) is likewise carried through verbatim — it is what lets a per-transfer
 * row be deduped and authored with its full provenance client-side. When the
 * fetched token object carries `address`/`decimals` (EVM/Tron), those ride
 * along as `tokenMeta` so the backend import path can rebuild the structured
 * token instead of losing decimals — see traces.service.ts `evmToken()`.
 */
export function mapFetchedTx(tx: FetchedTx, chain: string): ImportItem {
  const token = typeof tx.token === 'string' ? tx.token : tx.token?.symbol ?? '';
  const item: ImportItem = {
    from: tx.from,
    to: tx.to,
    txHash: tx.txHash,
    chain,
    timestamp: parseTimestamp(tx.timestamp).toISOString(),
    amount: tx.amount,
    token,
  };
  if (tx.blockNumber !== undefined) item.blockNumber = tx.blockNumber;
  if (tx.fromLabel !== undefined) item.fromLabel = tx.fromLabel;
  if (tx.toLabel !== undefined) item.toLabel = tx.toLabel;
  if (tx.utxo !== undefined) item.utxo = tx.utxo;
  if (tx.solana !== undefined) item.solana = tx.solana;
  if (typeof tx.token === 'object' && tx.token?.address !== undefined && tx.token?.decimals !== undefined) {
    item.tokenMeta = { address: tx.token.address, decimals: tx.token.decimals };
  }
  return item;
}

/**
 * Map a single transaction's detail to one import row, choosing the leg the
 * same way Quick Add does (`selectPrimaryTransfer`) so a seeded transaction and
 * a Quick-Added one produce the same edge and dedupe against each other.
 * Returns null when nothing readable moved (e.g. value carried only by
 * internal transfers, which are not fetched).
 */
export function mapTxDetail(detail: TransactionDetail, chain: string): ImportItem | null {
  const legs = detail.transfers ?? [];
  const primaryIndex = selectPrimaryTransfer(legs, detail.from);
  const primary = primaryIndex >= 0 ? legs[primaryIndex] : undefined;
  const legacy = detail.tokenTransfers[0];

  const amount = primary?.amount ?? legacy?.amount ?? detail.amount;
  if (!primary && !legacy && (!amount || amount === '0')) return null;

  const item = mapFetchedTx(
    {
      from: primary?.from ?? legacy?.from ?? detail.from,
      to: primary?.to ?? legacy?.to ?? detail.to,
      txHash: detail.txHash,
      timestamp: detail.timestamp,
      amount,
      token: primary?.token || legacy?.token || detail.token,
      blockNumber: detail.blockNumber,
    },
    chain,
  );
  if (detail.solana) item.solana = detail.solana as ImportItem['solana'];
  return item;
}

/**
 * Drop duplicate rows, preserving first-seen order. Keyed by the same
 * `edgeIdentityKey` the import/authoring paths use, so a BTC leg row keys on
 * `txid:in:i` / `txid:vout` instead of the generic `txHash-from-to` triple —
 * without this, two legs of the same junction transaction that happen to
 * share a `from`/`to` (e.g. two outputs paying the same address) would
 * collapse into one.
 */
export function dedupeTxs(items: ImportItem[]): ImportItem[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const key = edgeIdentityKey(t, t.from, t.to);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fetch-first case seed pipeline. Fetches recent history for every wallet and
 * the exact detail for every transaction hash, in parallel, maps + dedupes the
 * results, and ONLY THEN creates the investigation, trace, and imports the
 * transactions. If nothing yields a transaction, nothing is created and
 * `SeedEmptyError` is thrown. A single input failing (rate limit, bad input)
 * is collected into `errors` and does not abort the run as long as at least
 * one input returns data.
 */
export async function runSeed(
  caseId: string,
  { addresses, txHashes }: SeedInputs,
  chain: string,
  onPhase?: (phase: SeedPhase) => void,
): Promise<SeedResult> {
  onPhase?.('fetching');
  const errors: SeedAddressError[] = [];
  const failure = (reason: unknown) => (reason instanceof Error ? reason.message : 'Fetch failed');

  const [historyResults, txResults] = await Promise.all([
    Promise.allSettled(
      addresses.map((a) =>
        apiClient.fetchHistory(a, chain, {
          sort: 'desc',
          ...(usesCursorPagination(chain) ? { maxTotal: SEED_TX_LIMIT } : { offset: SEED_TX_LIMIT }),
        }),
      ),
    ),
    Promise.allSettled(txHashes.map((h) => apiClient.getTransaction(h, chain))),
  ]);

  const items: ImportItem[] = [];
  historyResults.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      items.push(...res.value.transactions.map((t) => mapFetchedTx(t as FetchedTx, chain)));
    } else {
      errors.push({ address: addresses[i], message: failure(res.reason) });
    }
  });
  txResults.forEach((res, i) => {
    if (res.status === 'rejected') {
      errors.push({ address: txHashes[i], message: failure(res.reason) });
      return;
    }
    const item = mapTxDetail(res.value, chain);
    if (item) items.push(item);
    else errors.push({ address: txHashes[i], message: 'No token or native value moved in this transaction' });
  });

  const deduped = dedupeTxs(items);
  if (deduped.length === 0) {
    onPhase?.('error');
    throw new SeedEmptyError('No transactions found for the given input(s).');
  }

  onPhase?.('creating');
  const inputs = [...txHashes, ...addresses];
  const traceName =
    inputs.length > 1
      ? `${shortAddress(inputs[0])} +${inputs.length - 1} more`
      : shortAddress(inputs[0]);
  const inv = await apiClient.createInvestigation(caseId, {
    name: 'Fund tracing',
    initialTraceName: traceName,
  });
  const trace = inv.traces![0];

  onPhase?.('importing');
  const imported = await apiClient.importTransactions(trace.id, deduped);

  onPhase?.('done');
  return {
    investigationId: inv.id,
    traceId: trace.id,
    nodeCount: imported.added.nodes,
    edgeCount: imported.added.edges,
    txCount: deduped.length,
    errors,
  };
}

/**
 * React binding around `runSeed`. Tracks phase, error, and result so a wizard
 * UI can render progress. `seed` resolves to the result, or `null` if the run
 * failed (error message is available via the returned `error`).
 */
export function useCaseSeed(caseId: string) {
  const [phase, setPhase] = useState<SeedPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SeedResult | null>(null);

  const seed = useCallback(
    async (inputs: SeedInputs, chain: string) => {
      setError(null);
      setResult(null);
      try {
        const r = await runSeed(caseId, inputs, chain, setPhase);
        setResult(r);
        return r;
      } catch (e) {
        setPhase('error');
        setError(
          e instanceof SeedEmptyError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Seeding failed',
        );
        return null;
      }
    },
    [caseId],
  );

  return { seed, phase, error, result };
}
