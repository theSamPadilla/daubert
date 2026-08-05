'use client';

import { useState } from 'react';
import { FaArrowUpRightFromSquare, FaCheck } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '../../generated/api-types';
import { Investigation } from '../../types/investigation';
import { buildTxExplorerUrl } from '../../utils/addressParser';

type ImportTransactionItem = components['schemas']['ImportTransactionItem'];

// Mirrors the backend's ImportTransactionsDto.transactions cap (5000) with
// headroom to spare — batching here keeps each POST's validation cost low
// regardless of how many rows the user selects.
const IMPORT_BATCH_SIZE = 500;

type Props = {
  investigation: Investigation;
  defaultTargetTraceId?: string;
  results: ImportTransactionItem[];
  onImportDone: (importedCount: number) => void;
};

/** Truncate a hex address or tx hash for display: 0x1234…abcd */
function truncateAddr(addr: string): string {
  if (!addr || addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Truncate a tx hash a bit more: 0x1234…5678 */
function truncateTx(hash: string): string {
  if (!hash || hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

/** Format an ISO timestamp string to a readable short form. */
function formatTimestamp(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function SearchResults({ investigation, defaultTargetTraceId, results, onImportDone }: Props) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(results.map((_, i) => i)),
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Target trace for import — defaults to selectedTraceId, then first trace
  const defaultId = defaultTargetTraceId ?? investigation.traces[0]?.id ?? '';
  const [targetTraceId, setTargetTraceId] = useState<string>(defaultId);

  const allSelected = selected.size === results.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((_, i) => i)));
    }
  };

  const toggleRow = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0 || !targetTraceId) return;
    setImporting(true);
    setImportError(null);
    setImportSuccess(null);

    const items = [...selected].map((idx) => results[idx]);
    const targetName = investigation.traces.find((t) => t.id === targetTraceId)?.name ?? targetTraceId;

    try {
      let count = 0;
      for (let i = 0; i < items.length; i += IMPORT_BATCH_SIZE) {
        const batch = items.slice(i, i + IMPORT_BATCH_SIZE);
        const res = await apiClient.importTransactions(targetTraceId, batch);
        count += res.added.edges;
      }
      setImportSuccess(
        `Imported ${count} transaction${count !== 1 ? 's' : ''} into "${targetName}".`,
      );
      onImportDone(count);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Import failed, please try again';
      setImportError(msg);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Success banner */}
      {importSuccess && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-300 rounded-lg text-xs text-emerald-700">
          <FaCheck className="w-3 h-3 shrink-0" />
          {importSuccess}
        </div>
      )}

      {/* Error banner */}
      {importError && (
        <div className="px-3 py-2 bg-redline/10 border border-redline/40 rounded-lg text-xs text-redline">
          {importError}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-line rounded-lg">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-raised/50">
              <th className="w-8 px-2 py-2 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="cursor-pointer accent-brand"
                  aria-label="Select all"
                />
              </th>
              <th className="px-2 py-2 text-left font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
                From
              </th>
              <th className="px-2 py-2 text-left font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
                To
              </th>
              <th className="px-2 py-2 text-left font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
                Amount
              </th>
              <th className="px-2 py-2 text-left font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
                Token
              </th>
              <th className="px-2 py-2 text-left font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
                Timestamp
              </th>
              <th className="px-2 py-2 text-left font-semibold text-ink-muted uppercase tracking-wider whitespace-nowrap">
                Tx Hash
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((item, idx) => {
              const isSelected = selected.has(idx);
              const explorerUrl = buildTxExplorerUrl(item.chain, item.txHash);
              return (
                <tr
                  key={idx}
                  onClick={() => toggleRow(idx)}
                  className={`border-b border-line last:border-0 cursor-pointer transition-colors ${
                    isSelected ? 'bg-brand/5' : 'hover:bg-surface-raised/40'
                  }`}
                >
                  <td className="w-8 px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(idx)}
                      className="cursor-pointer accent-brand"
                      aria-label={`Select transaction ${item.txHash}`}
                    />
                  </td>
                  <td className="px-2 py-2 font-mono text-ink-muted whitespace-nowrap">
                    {truncateAddr(item.from)}
                  </td>
                  <td className="px-2 py-2 font-mono text-ink-muted whitespace-nowrap">
                    {truncateAddr(item.to)}
                  </td>
                  <td className="px-2 py-2 text-ink whitespace-nowrap">
                    {item.amount}
                  </td>
                  <td className="px-2 py-2 text-ink whitespace-nowrap">
                    {item.token}
                  </td>
                  <td className="px-2 py-2 text-ink-muted whitespace-nowrap">
                    {formatTimestamp(item.timestamp)}
                  </td>
                  <td className="px-2 py-2 font-mono whitespace-nowrap">
                    {explorerUrl ? (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-brand hover:text-brand-strong hover:underline"
                      >
                        {truncateTx(item.txHash)}
                        <FaArrowUpRightFromSquare className="w-2.5 h-2.5 shrink-0" />
                      </a>
                    ) : (
                      <span className="text-ink-muted">{truncateTx(item.txHash)}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer — import target dropdown + import button */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {selected.size} of {results.length} selected
        </span>

        <div className="flex items-center gap-2 shrink-0">
          {/* Import into: trace dropdown */}
          {investigation.traces.length > 1 && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-ink-muted whitespace-nowrap">Import into:</label>
              <select
                value={targetTraceId}
                onChange={(e) => setTargetTraceId(e.target.value)}
                className="bg-surface border border-line-strong rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {investigation.traces.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={handleImport}
            disabled={selected.size === 0 || importing || !targetTraceId}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand text-white hover:bg-brand-strong disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-semibold transition-colors"
          >
            {importing ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Importing…
              </>
            ) : (
              `Import ${selected.size} selected`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
