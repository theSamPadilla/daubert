'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { FaXmark, FaMagnifyingGlass, FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '../../generated/api-types';
import { Investigation } from '../../types/investigation';
import { WalletGroupPicker } from './WalletGroupPicker';
import { SearchResults } from './SearchResults';
import { ChainSelect } from '@/components/Graph/ChainSelect';
import { Loader } from '@/components/Common/Loader';

type ImportTransactionItem = components['schemas']['ImportTransactionItem'];
type PickerValue = { traceId?: string; groupId?: string; wallets?: string[] };

type Props = {
  investigation: Investigation;
  selectedTraceId?: string;
  open: boolean;
  onClose: () => void;
};

/** Compute the chain that has the most nodes across all traces; fallback to 'ethereum'. */
function defaultChainFor(investigation: Investigation): string {
  const counts = new Map<string, number>();
  for (const trace of investigation.traces) {
    for (const node of trace.nodes) {
      counts.set(node.chain, (counts.get(node.chain) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return 'ethereum';
  let best = '';
  let bestCount = 0;
  for (const [ch, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      best = ch;
    }
  }
  return best || 'ethereum';
}

/** De-duped list of chains present across all traces' nodes. */
function chainsInInvestigation(investigation: Investigation): string[] {
  const seen = new Set<string>();
  for (const trace of investigation.traces) {
    for (const node of trace.nodes) {
      if (node.chain) seen.add(node.chain);
    }
  }
  return [...seen].sort();
}

/** Convert a datetime-local string (YYYY-MM-DDTHH:mm) to unix seconds. Returns undefined if empty. */
function datetimeToUnix(value: string): number | undefined {
  if (!value) return undefined;
  return Math.floor(new Date(value).getTime() / 1000);
}

/** Whether a PickerValue counts as "filled" for the purposes of enabling Search. */
function isPickerFilled(v: PickerValue): boolean {
  return !!(v.traceId || v.groupId || (v.wallets && v.wallets.length >= 1));
}

export function SearchPanel({ investigation, selectedTraceId, open, onClose }: Props) {
  const initialChain = useMemo(() => defaultChainFor(investigation), [investigation]);
  const chains = useMemo(() => chainsInInvestigation(investigation), [investigation]);

  const [chain, setChain] = useState<string>(initialChain);
  const [sideA, setSideA] = useState<PickerValue>({});
  const [sideB, setSideB] = useState<PickerValue>({});
  const [timeRange, setTimeRange] = useState<{ start?: number; end?: number }>({});
  const [startDt, setStartDt] = useState('');
  const [endDt, setEndDt] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [results, setResults] = useState<ImportTransactionItem[] | null>(null);
  const [analyzedCount, setAnalyzedCount] = useState<number | null>(null);
  const [fetchedSide, setFetchedSide] = useState<'A' | 'B' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedAddresses, setFailedAddresses] = useState<string[]>([]);

  // AbortController ref — cancel in-flight search when modal closes mid-search
  const abortRef = useRef<AbortController | null>(null);

  // When the modal closes, abort any in-flight request and reset transient state
  useEffect(() => {
    if (!open) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [open]);

  // Reset state when the investigation changes
  useEffect(() => {
    const newDefault = defaultChainFor(investigation);
    setChain(newDefault);
    setSideA({});
    setSideB({});
    setResults(null);
    setAnalyzedCount(null);
    setFetchedSide(null);
    setError(null);
    setFailedAddresses([]);
  }, [investigation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChainChange = (next: string) => {
    setChain(next);
    setSideA({});
    setSideB({});
    setResults(null);
    setAnalyzedCount(null);
    setFetchedSide(null);
    setError(null);
  };

  const handleStartDt = (value: string) => {
    setStartDt(value);
    setTimeRange((prev) => ({ ...prev, start: datetimeToUnix(value) }));
  };

  const handleEndDt = (value: string) => {
    setEndDt(value);
    setTimeRange((prev) => ({ ...prev, end: datetimeToUnix(value) }));
  };

  const canSearch = chain && isPickerFilled(sideA) && isPickerFilled(sideB) && !loading;

  const handleSearch = async () => {
    if (!canSearch) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResults(null);
    setAnalyzedCount(null);
    setFetchedSide(null);
    setFailedAddresses([]);

    try {
      const payload: components['schemas']['SearchBetweenRequest'] = {
        chain,
        sideA: sideA as components['schemas']['WalletSet'],
        sideB: sideB as components['schemas']['WalletSet'],
        ...(timeRange.start != null || timeRange.end != null
          ? {
              timeRange: {
                ...(timeRange.start != null ? { startTimestamp: timeRange.start } : {}),
                ...(timeRange.end != null ? { endTimestamp: timeRange.end } : {}),
              },
            }
          : {}),
      };

      const res = await apiClient.searchBetween(investigation.id, payload);
      if (!controller.signal.aborted) {
        setResults(res.results);
        setAnalyzedCount(res.analyzedCount ?? null);
        setFetchedSide(res.fetchedSide ?? null);
        setFailedAddresses(res.failedAddresses ?? []);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const msg =
        err instanceof Error
          ? err.message
          : 'Search failed — please try again';
      setError(msg);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleClose = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-panel border border-line-strong rounded-xl shadow-2xl w-[1100px] max-w-[95vw] max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-strong shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              Find transactions between wallets
            </span>
            <span className="text-[11px] text-ink-faint truncate">
              {investigation.name || 'Untitled investigation'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-ink-faint hover:text-ink transition-colors shrink-0 ml-3"
            aria-label="Close"
          >
            <FaXmark className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 flex flex-col gap-4">

          {/* Chain selector */}
          <div>
            <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">
              Chain
            </label>
            {chains.length === 0 ? (
              <p className="text-xs text-ink-faint italic">No chains detected in this investigation.</p>
            ) : (
              <ChainSelect
                value={chain}
                options={chains}
                onChange={handleChainChange}
              />
            )}
          </div>

          {/* Two-column pickers */}
          <div className="grid grid-cols-2 gap-4">
            <WalletGroupPicker
              label="Side A"
              investigation={investigation}
              chain={chain}
              value={sideA}
              onChange={setSideA}
            />
            <WalletGroupPicker
              label="Side B"
              investigation={investigation}
              chain={chain}
              value={sideB}
              onChange={setSideB}
            />
          </div>

          {/* Advanced (collapsible) — time range */}
          <div className="border border-line-strong rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center gap-2 w-full px-3 py-2 bg-surface-panel text-xs font-semibold text-ink-muted uppercase tracking-wider hover:bg-surface-raised/40 transition-colors"
            >
              {advancedOpen ? (
                <FaChevronDown className="w-3 h-3" />
              ) : (
                <FaChevronRight className="w-3 h-3" />
              )}
              Time Range (optional)
            </button>

            {advancedOpen && (
              <div className="grid grid-cols-2 gap-3 px-3 py-3 border-t border-line-strong">
                <div>
                  <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">
                    Start
                  </label>
                  <input
                    type="datetime-local"
                    value={startDt}
                    onChange={(e) => handleStartDt(e.target.value)}
                    max={endDt || undefined}
                    className="w-full bg-surface border border-line-strong rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">
                    End
                  </label>
                  <input
                    type="datetime-local"
                    value={endDt}
                    onChange={(e) => handleEndDt(e.target.value)}
                    min={startDt || undefined}
                    className="w-full bg-surface border border-line-strong rounded px-2.5 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="px-3 py-2 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Partial-failure warning banner */}
          {failedAddresses.length > 0 && (
            <div className="px-3 py-2 bg-amber-900/30 border border-amber-600/50 rounded text-xs text-amber-400">
              {(() => {
                const shown = failedAddresses.slice(0, 3);
                const rest = failedAddresses.length - shown.length;
                const list = shown.map((a) => `${a.slice(0, 8)}…${a.slice(-4)}`).join(', ');
                return `Could not fetch history for ${failedAddresses.length} wallet${failedAddresses.length > 1 ? 's' : ''}: ${list}${rest > 0 ? ` and ${rest} more` : ''}. Results may be incomplete.`;
              })()}
            </div>
          )}

          {/* Results area */}
          {results !== null && !loading && (
            <div className="flex flex-col gap-2">
              {/* Coverage subtitle */}
              {analyzedCount != null && fetchedSide != null && (() => {
                const fetchedPicker = fetchedSide === 'A' ? sideA : sideB;
                const walletCount = fetchedPicker.wallets?.length;
                const walletLabel = walletCount != null
                  ? `${walletCount} wallet${walletCount !== 1 ? 's' : ''}`
                  : `the Side ${fetchedSide} wallets`;
                return (
                  <p className="text-xs text-ink-faint italic">
                    Analyzed{' '}
                    <span className="font-medium text-ink-muted">
                      {analyzedCount.toLocaleString('en-US')}
                    </span>{' '}
                    transaction{analyzedCount !== 1 ? 's' : ''} across{' '}
                    <span className="font-medium text-ink-muted">{walletLabel}</span>{' '}
                    (Side {fetchedSide}).
                  </p>
                );
              })()}
              {results.length === 0 ? (
                <p className="text-sm text-ink-faint text-center py-4">
                  No matching transactions found in this range.
                </p>
              ) : (
                <SearchResults
                  investigation={investigation}
                  defaultTargetTraceId={selectedTraceId}
                  results={results}
                  onImportDone={() => {
                    setResults(null);
                  }}
                />
              )}
            </div>
          )}

          {loading && <Loader inline />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line-strong shrink-0">
          <p className="text-[11px] text-ink-faint flex-1">
            Direct on-chain transfers only. Contract-internal calls are not searched.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-1.5 bg-surface-raised hover:bg-surface-raised/80 rounded text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSearch}
              disabled={!canSearch}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-brand hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-semibold transition-colors"
            >
              {loading ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <FaMagnifyingGlass className="w-3.5 h-3.5" />
                  Search
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
