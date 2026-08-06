'use client';

import { useState, useMemo } from 'react';
import { FaXmark } from 'react-icons/fa6';
import { IconButton } from '@/components/ui';
import { apiClient } from '@/lib/api-client';
import { SUPPORTED_CHAINS } from '@/services/types';
import { Trace, TransactionEdge } from '@/types/investigation';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '@/utils/formatAmount';
import { classifyBtcRow } from '@/utils/btcRowDisplay';
import { classifySolanaRow } from '@/utils/classifySolanaRow';
import { evidenceTitle } from '@/utils/utxoDisplay';
import { edgeIdentityKey } from '../../generated/shared/edge-identity';
import { usesCursorPagination } from '../../generated/shared/chains';

interface FetchModalProps {
  initialAddress?: string;
  initialChain?: string;
  traces: Trace[];
  existingTxKeys: Set<string>;   // built via edgeIdentityKey()
  onAdd: (traceId: string, transactions: TransactionEdge[]) => void;
  onClose: () => void;
}

function truncate(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function formatTs(ts: string) {
  return parseTimestamp(ts).toLocaleDateString(undefined, {
    year: '2-digit', month: 'short', day: 'numeric',
  });
}

const BADGE_CLASS = 'px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap';

/** Bitcoin-only row badges (direction, in/out counts, change?, junction). Renders nothing for non-BTC rows. */
function BtcBadges({ tx, fetchedAddress }: { tx: TransactionEdge; fetchedAddress: string }) {
  const info = classifyBtcRow(tx, fetchedAddress);
  if (!info) return null;

  const dirClass =
    info.direction === 'in'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : info.direction === 'out'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-surface-raised text-ink-muted border-line';
  const dirLabel = info.direction === 'in' ? 'In' : info.direction === 'out' ? 'Out' : 'Self';

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className={`${BADGE_CLASS} ${dirClass}`}>{dirLabel}</span>
      <span className={`${BADGE_CLASS} bg-surface-raised text-ink-muted border-line`}>
        {info.inCount} in / {info.outCount} out
      </span>
      {info.isChange && (
        <span
          className={`${BADGE_CLASS} bg-amber-50 text-amber-700 border-amber-200`}
          title={evidenceTitle(info.changeEvidence)}
        >
          change?
        </span>
      )}
      {info.isJunction && (
        <span className={`${BADGE_CLASS} bg-indigo-50 text-indigo-700 border-indigo-200`}>
          junction
        </span>
      )}
    </div>
  );
}

/** Solana-only row badges (direction, token symbol, spam?). Renders nothing for non-Solana rows. */
function SolBadges({ tx, fetchedAddress }: { tx: TransactionEdge; fetchedAddress: string }) {
  const info = classifySolanaRow(tx, fetchedAddress);
  if (!info) return null;

  const dirClass =
    info.direction === 'in'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : info.direction === 'out'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-surface-raised text-ink-muted border-line';
  const dirLabel = info.direction === 'in' ? 'In' : info.direction === 'out' ? 'Out' : 'Self';
  const tok = normalizeToken(tx.token);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className={`${BADGE_CLASS} ${dirClass}`}>{dirLabel}</span>
      <span className={`${BADGE_CLASS} bg-surface-raised text-ink-muted border-line`}>
        {tok.symbol}
      </span>
      {info.isSpam && (
        <span
          className={`${BADGE_CLASS} bg-amber-50 text-amber-700 border-amber-200`}
          title={evidenceTitle(info.evidence)}
        >
          spam?
        </span>
      )}
    </div>
  );
}

export function FetchModal({
  initialAddress = '',
  initialChain = 'ethereum',
  traces,
  existingTxKeys,
  onAdd,
  onClose,
}: FetchModalProps) {
  // ── Configure step ────────────────────────────────────────────────────
  const [address, setAddress] = useState(initialAddress);
  const [chain, setChain] = useState(initialChain);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startBlock, setStartBlock] = useState('');
  const [endBlock, setEndBlock] = useState('');
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [limit, setLimit] = useState(200);

  // ── Results step ──────────────────────────────────────────────────────
  const [results, setResults] = useState<TransactionEdge[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetTraceId, setTargetTraceId] = useState(traces[0]?.id || '');
  // Snapshot of the address actually used for the last fetch — decoupled from
  // the (still-editable) `address` input so BTC direction badges stay correct
  // even if the user edits the field after fetching but before adding rows.
  const [fetchedAddress, setFetchedAddress] = useState('');

  // Deduplicate against existing graph
  const isDuplicate = useMemo(() => {
    const map = new Map<string, boolean>();
    results?.forEach((tx) => {
      map.set(tx.id, existingTxKeys.has(edgeIdentityKey(tx, tx.from, tx.to)));
    });
    return map;
  }, [results, existingTxKeys]);

  const newResults = useMemo(() => results?.filter((tx) => !isDuplicate.get(tx.id)) ?? [], [results, isDuplicate]);

  const hasBtcRows = useMemo(() => !!results?.some((tx) => !!tx.utxo), [results]);
  const hasSolanaRows = useMemo(() => !!results?.some((tx) => !!tx.solana), [results]);

  // Rows eligible for the "select all" bulk-toggle. Change-flagged BTC rows
  // and spam-flagged Solana rows are excluded — they default to unchecked
  // and require a deliberate manual click, since an investigator should
  // confirm a change output (or a spam airdrop) before it's treated as a
  // real counterparty transfer. Rows outside these chains are always
  // eligible (classifyBtcRow/classifySolanaRow return null for them, so
  // isChange/isSpam are never true).
  const selectableResults = useMemo(
    () =>
      newResults.filter(
        (tx) => !classifyBtcRow(tx, fetchedAddress)?.isChange && !classifySolanaRow(tx, fetchedAddress)?.isSpam,
      ),
    [newResults, fetchedAddress],
  );

  const handleFetch = async () => {
    if (!address.trim()) return;
    const addr = address.trim();
    setLoading(true);
    setError(null);
    setResults(null);
    setSelected(new Set());
    try {
      const res = await apiClient.fetchHistory(addr, chain, {
        ...(!usesCursorPagination(chain) && startBlock ? { startBlock: parseInt(startBlock) } : {}),
        ...(!usesCursorPagination(chain) && endBlock ? { endBlock: parseInt(endBlock) } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(usesCursorPagination(chain) ? { maxTotal: limit } : { offset: limit }),
        sort,
      });
      const rows = res.transactions as TransactionEdge[];
      setFetchedAddress(addr);
      setResults(rows);
      // Auto-select all non-duplicates, excluding change-flagged BTC rows and
      // spam-flagged Solana rows.
      setSelected(new Set(
        rows
          .filter((tx) => !existingTxKeys.has(edgeIdentityKey(tx, tx.from, tx.to)))
          .filter((tx) => !classifyBtcRow(tx, addr)?.isChange && !classifySolanaRow(tx, addr)?.isSpam)
          .map((tx) => tx.id)
      ));
    } catch (err: any) {
      setError(err?.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const allSelectableSelected =
        selectableResults.length > 0 && selectableResults.every((tx) => prev.has(tx.id));
      const next = new Set(prev);
      selectableResults.forEach((tx) => (allSelectableSelected ? next.delete(tx.id) : next.add(tx.id)));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    if (!results || !targetTraceId) return;
    const toAdd = results.filter((tx) => selected.has(tx.id));
    onAdd(targetTraceId, toAdd);
    onClose();
  };

  const allSelectableSelected =
    selectableResults.length > 0 && selectableResults.every((tx) => selected.has(tx.id));

  const fieldClass =
    'w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-[2px]">
      <div className="bg-surface rounded-xl border border-line shadow-[0_24px_60px_-30px_rgba(11,18,32,0.25)] w-[680px] max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <span className="text-[15px] font-medium text-ink">Fetch Transactions</span>
          <IconButton aria-label="Close" onClick={onClose}>
            <FaXmark />
          </IconButton>
        </div>

        {/* Configure */}
        <div className="px-5 py-4 border-b border-line shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">Chain</label>
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className={fieldClass}
              >
                {Object.values(SUPPORTED_CHAINS).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">Sort</label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'asc' | 'desc')}
                className={fieldClass}
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">
                Start Date <span className="text-ink-faint normal-case font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                max={endDate || undefined}
                className={fieldClass}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">
                End Date <span className="text-ink-faint normal-case font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className={fieldClass}
              />
            </div>
            {!usesCursorPagination(chain) && (
              <div>
                <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">
                  Start Block <span className="text-ink-faint normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  value={startBlock}
                  onChange={(e) => setStartBlock(e.target.value)}
                  placeholder="e.g. 18000000"
                  disabled={!!startDate}
                  className={`${fieldClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                />
              </div>
            )}
            {!usesCursorPagination(chain) && (
              <div>
                <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">
                  End Block <span className="text-ink-faint normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  value={endBlock}
                  onChange={(e) => setEndBlock(e.target.value)}
                  placeholder="e.g. 19000000"
                  disabled={!!endDate}
                  className={`${fieldClass} disabled:opacity-40 disabled:cursor-not-allowed`}
                />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">Limit</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className={fieldClass}
              >
                {[50, 100, 200, 500, 1000, 5000].map((n) => (
                  <option key={n} value={n}>{n} transactions</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleFetch}
                disabled={loading || !address.trim()}
                className="w-full h-9 px-4 bg-brand text-white hover:bg-brand-strong disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors inline-flex items-center justify-center"
              >
                {loading ? 'Fetching…' : results ? 'Re-fetch' : 'Fetch'}
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-redline">{error}</p>}
        </div>

        {/* Results */}
        {results && (
          <>
            <div className="flex items-center justify-between px-5 py-2 border-b border-line shrink-0">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allSelectableSelected}
                  onChange={toggleAll}
                  className="accent-brand"
                />
                <span className="text-xs text-ink-muted">
                  {results.length} found · {newResults.length} new · {selected.size} selected
                  {results.length - newResults.length > 0 && (
                    <span className="text-ink-faint"> · {results.length - newResults.length} already in graph</span>
                  )}
                </span>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 text-xs">
              {results.length === 0 ? (
                <p className="text-ink-faint text-center py-8">No transactions found.</p>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-surface border-b border-line">
                    <tr className="text-left text-[10px] font-semibold text-ink-faint uppercase">
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Token</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
                      {(hasBtcRows || hasSolanaRows) && <th className="px-3 py-2">Info</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((tx) => {
                      const dup = isDuplicate.get(tx.id);
                      const isSelected = selected.has(tx.id);
                      const tok = normalizeToken(tx.token);
                      return (
                        <tr
                          key={tx.id}
                          onClick={() => !dup && toggleOne(tx.id)}
                          className={`border-b border-line/50 transition-colors ${
                            dup
                              ? 'opacity-35 cursor-default'
                              : isSelected
                              ? 'bg-brand/10 cursor-pointer hover:bg-brand/15'
                              : 'cursor-pointer hover:bg-surface-raised/40'
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            {dup ? (
                              <span className="text-ink-faint text-[10px]">in graph</span>
                            ) : (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleOne(tx.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="accent-brand"
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-ink-muted whitespace-nowrap">{formatTs(tx.timestamp as string)}</td>
                          <td className="px-3 py-1.5 text-ink font-mono whitespace-nowrap">
                            {formatTokenAmount(tx.amount, tok.decimals)}
                          </td>
                          <td className="px-3 py-1.5 text-ink-muted">{tok.symbol}</td>
                          <td className="px-3 py-1.5 font-mono text-ink-muted">{truncate(tx.from)}</td>
                          <td className="px-3 py-1.5 font-mono text-ink-muted">{truncate(tx.to)}</td>
                          {(hasBtcRows || hasSolanaRows) && (
                            <td className="px-3 py-1.5">
                              <BtcBadges tx={tx} fetchedAddress={fetchedAddress} />
                              <SolBadges tx={tx} fetchedAddress={fetchedAddress} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-3 border-t border-line shrink-0">
              <label className="text-xs font-semibold text-ink-muted uppercase whitespace-nowrap">Add to</label>
              <select
                value={targetTraceId}
                onChange={(e) => setTargetTraceId(e.target.value)}
                className="flex-1 bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {traces.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                onClick={handleAdd}
                disabled={selected.size === 0 || !targetTraceId}
                className="px-4 py-1.5 bg-brand text-white hover:bg-brand-strong disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors whitespace-nowrap"
              >
                Add {selected.size > 0 ? `${selected.size} ` : ''}to Graph
              </button>
              <button
                onClick={onClose}
                className="px-4 py-1.5 bg-surface text-ink-muted border border-line-strong hover:bg-surface-raised rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {!results && !loading && (
          <div className="flex-1 flex items-center justify-center text-ink-faint text-sm py-8">
            Configure your query above and click Fetch.
          </div>
        )}

        {loading && (
          <div className="flex-1 flex items-center justify-center text-ink-muted text-sm py-8">
            Fetching transactions…
          </div>
        )}
      </div>
    </div>
  );
}
