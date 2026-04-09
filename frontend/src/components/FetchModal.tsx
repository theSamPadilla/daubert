'use client';

import { useState, useMemo } from 'react';
import { apiClient } from '@/lib/api-client';
import { SUPPORTED_CHAINS } from '../services/types';
import { Trace, TransactionEdge } from '../types/investigation';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '../utils/formatAmount';

interface FetchModalProps {
  initialAddress?: string;
  initialChain?: string;
  traces: Trace[];
  existingTxKeys: Set<string>;   // `${txHash}-${from}-${to}`
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

  // Deduplicate against existing graph
  const isDuplicate = useMemo(() => {
    const map = new Map<string, boolean>();
    results?.forEach((tx) => {
      map.set(tx.id, existingTxKeys.has(`${tx.txHash}-${tx.from}-${tx.to}`));
    });
    return map;
  }, [results, existingTxKeys]);

  const newResults = useMemo(() => results?.filter((tx) => !isDuplicate.get(tx.id)) ?? [], [results, isDuplicate]);

  const handleFetch = async () => {
    if (!address.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setSelected(new Set());
    try {
      const res = await apiClient.fetchHistory(address.trim(), chain, {
        ...(startBlock ? { startBlock: parseInt(startBlock) } : {}),
        ...(endBlock ? { endBlock: parseInt(endBlock) } : {}),
        offset: limit,
        sort,
      });
      setResults(res.transactions as TransactionEdge[]);
      // Auto-select all non-duplicates
      setSelected(new Set(
        (res.transactions as TransactionEdge[])
          .filter((tx) => !existingTxKeys.has(`${tx.txHash}-${tx.from}-${tx.to}`))
          .map((tx) => tx.id)
      ));
    } catch (err: any) {
      setError(err?.message || 'Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === newResults.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(newResults.map((tx) => tx.id)));
    }
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

  const allNewSelected = newResults.length > 0 && selected.size === newResults.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-700 shrink-0">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Fetch Transactions</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">✕</button>
        </div>

        {/* Configure */}
        <div className="px-5 py-4 border-b border-gray-700 shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="0x..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Chain</label>
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm"
              >
                {Object.values(SUPPORTED_CHAINS).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Sort</label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as 'asc' | 'desc')}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm"
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Start Block <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
              <input
                type="number"
                value={startBlock}
                onChange={(e) => setStartBlock(e.target.value)}
                placeholder="e.g. 18000000"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">End Block <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
              <input
                type="number"
                value={endBlock}
                onChange={(e) => setEndBlock(e.target.value)}
                placeholder="e.g. 19000000"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Limit</label>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm"
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
                className="w-full px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition-colors"
              >
                {loading ? 'Fetching…' : results ? 'Re-fetch' : 'Fetch'}
              </button>
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        {/* Results */}
        {results && (
          <>
            <div className="flex items-center justify-between px-5 py-2 border-b border-gray-700 shrink-0">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={allNewSelected}
                  onChange={toggleAll}
                  className="accent-blue-500"
                />
                <span className="text-xs text-gray-400">
                  {results.length} found · {newResults.length} new · {selected.size} selected
                  {results.length - newResults.length > 0 && (
                    <span className="text-gray-600"> · {results.length - newResults.length} already in graph</span>
                  )}
                </span>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 text-xs">
              {results.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No transactions found.</p>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-800 border-b border-gray-700">
                    <tr className="text-left text-[10px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 w-8"></th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Token</th>
                      <th className="px-3 py-2">From</th>
                      <th className="px-3 py-2">To</th>
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
                          className={`border-b border-gray-700/50 transition-colors ${
                            dup
                              ? 'opacity-35 cursor-default'
                              : isSelected
                              ? 'bg-blue-600/10 cursor-pointer hover:bg-blue-600/15'
                              : 'cursor-pointer hover:bg-gray-700/40'
                          }`}
                        >
                          <td className="px-3 py-1.5">
                            {dup ? (
                              <span className="text-gray-600 text-[10px]">✓</span>
                            ) : (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleOne(tx.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="accent-blue-500"
                              />
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-gray-400 whitespace-nowrap">{formatTs(tx.timestamp as string)}</td>
                          <td className="px-3 py-1.5 text-gray-200 font-mono whitespace-nowrap">
                            {formatTokenAmount(tx.amount, tok.decimals)}
                          </td>
                          <td className="px-3 py-1.5 text-gray-400">{tok.symbol}</td>
                          <td className="px-3 py-1.5 font-mono text-gray-400">{truncate(tx.from)}</td>
                          <td className="px-3 py-1.5 font-mono text-gray-400">{truncate(tx.to)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-5 py-3 border-t border-gray-700 shrink-0">
              <label className="text-xs font-semibold text-gray-400 uppercase whitespace-nowrap">Add to</label>
              <select
                value={targetTraceId}
                onChange={(e) => setTargetTraceId(e.target.value)}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2.5 py-1.5 text-sm"
              >
                {traces.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                onClick={handleAdd}
                disabled={selected.size === 0 || !targetTraceId}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition-colors whitespace-nowrap"
              >
                Add {selected.size > 0 ? `${selected.size} ` : ''}to Graph
              </button>
              <button onClick={onClose} className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}

        {!results && !loading && (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-sm py-8">
            Configure your query above and click Fetch.
          </div>
        )}

        {loading && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm py-8">
            Fetching transactions…
          </div>
        )}
      </div>
    </div>
  );
}
