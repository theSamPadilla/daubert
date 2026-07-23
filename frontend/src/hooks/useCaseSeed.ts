import { useCallback, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { parseTimestamp } from '@/utils/formatAmount';
import type { components } from '@/generated/api-types';

type ImportItem = components['schemas']['ImportTransactionItem'];

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
 * AI scripts) that already pass a plain symbol string.
 */
interface FetchedTx {
  from: string;
  to: string;
  txHash: string;
  chain?: string;
  timestamp: string | number;
  amount: string;
  token: { symbol?: string } | string;
  blockNumber?: number;
  fromLabel?: string;
  toLabel?: string;
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
 * ISO or unix-seconds.
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
  return item;
}

/** Drop duplicate `txHash-from-to` triples, preserving first-seen order. */
export function dedupeTxs(items: ImportItem[]): ImportItem[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const key = `${t.txHash}-${t.from}-${t.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fetch-first case seed pipeline. Fetches history for every address in
 * parallel, maps + dedupes the results, and ONLY THEN creates the
 * investigation, trace, and imports the transactions. If no address yields any
 * transaction, nothing is created and `SeedEmptyError` is thrown. A single
 * address failing (rate limit, bad address) is collected into `errors` and does
 * not abort the run as long as at least one address returns data.
 */
export async function runSeed(
  caseId: string,
  addresses: string[],
  chain: string,
  onPhase?: (phase: SeedPhase) => void,
): Promise<SeedResult> {
  onPhase?.('fetching');
  const errors: SeedAddressError[] = [];
  const settled = await Promise.allSettled(
    addresses.map((a) => apiClient.fetchHistory(a, chain, { sort: 'desc', offset: SEED_TX_LIMIT })),
  );

  const items: ImportItem[] = [];
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      items.push(...res.value.transactions.map((t) => mapFetchedTx(t as FetchedTx, chain)));
    } else {
      errors.push({
        address: addresses[i],
        message: res.reason instanceof Error ? res.reason.message : 'Fetch failed',
      });
    }
  });

  const deduped = dedupeTxs(items);
  if (deduped.length === 0) {
    onPhase?.('error');
    throw new SeedEmptyError('No transactions found for the given address(es).');
  }

  onPhase?.('creating');
  const inv = await apiClient.createInvestigation(caseId, { name: 'Fund tracing' });
  const traceName =
    addresses.length > 1
      ? `${shortAddress(addresses[0])} +${addresses.length - 1} more`
      : shortAddress(addresses[0]);
  const trace = await apiClient.createTrace(inv.id, { name: traceName });

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
    async (addresses: string[], chain: string) => {
      setError(null);
      setResult(null);
      try {
        const r = await runSeed(caseId, addresses, chain, setPhase);
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
