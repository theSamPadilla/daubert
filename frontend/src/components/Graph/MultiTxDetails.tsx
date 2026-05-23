import { useState, useRef, ReactNode } from 'react';
import { FaArrowUpRightFromSquare, FaTrash, FaCheck, FaXmark } from 'react-icons/fa6';
import { TransactionEdge } from '@/types/investigation';
import { normalizeToken, parseTimestamp } from '@/utils/formatAmount';
import { buildTxExplorerUrl } from '@/utils/addressParser';
import { GroupColorPicker } from '@/components/Common/GroupColorPicker';

export interface MultiTxDetailsProps {
  edges: TransactionEdge[];

  // Title (top of panel). When editableLabel provided, renders an editable input
  // with the bundle-style rename UX; otherwise renders staticTitle as plain text.
  staticTitle: string;
  editableLabel?: { value: string; onChange: (next: string | undefined) => void };

  // Discriminator for the header label and optional token chip.
  headerKind: 'bundle' | 'aggregated';
  tokenChip?: string | null;

  // Optional color editor (bundle only).
  onColorChange?: (color: string) => void;
  color?: string;

  // Optional arc controls.
  onArcEdge?: (delta: number | null) => void;

  // Optional per-row delete (aggregated edges only — bundles have their own deletion model).
  onDeleteTransaction?: (txId: string) => void;

  // Footer actions row (collapse/expand + unbundle for bundles; nothing for aggregated).
  actions?: ReactNode;
}

const HEADER_LABELS: Record<MultiTxDetailsProps['headerKind'], string> = {
  bundle: 'Edge Bundle',
  aggregated: 'Aggregated Transactions',
};

function abbr(h: number): string {
  if (h >= 1e12) return `${(h / 1e12).toFixed(2).replace(/\.?0+$/, '')}T`;
  if (h >= 1e9)  return `${(h / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (h >= 1e6)  return `${(h / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (h >= 1e3)  return `${(h / 1e3).toFixed(1).replace(/\.?0+$/, '')}K`;
  return h.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function MultiTxDetails({
  edges,
  staticTitle,
  editableLabel,
  headerKind,
  tokenChip,
  onColorChange,
  color,
  onArcEdge,
  onDeleteTransaction,
  actions,
}: MultiTxDetailsProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(editableLabel?.value ?? '');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Reset local label state when the editable value identity changes (different bundle selected)
  const prevEditableValue = useRef(editableLabel?.value);
  if (prevEditableValue.current !== editableLabel?.value) {
    prevEditableValue.current = editableLabel?.value;
    setLabelValue(editableLabel?.value ?? '');
    setEditingLabel(false);
  }

  const commitLabel = () => {
    setEditingLabel(false);
    if (!editableLabel) return;
    const next = labelValue.trim();
    const prev = editableLabel.value;
    if (next !== prev) editableLabel.onChange(next || undefined);
  };

  // Per-token totals derived from edges
  const tokenTotals = edges.reduce((map, e) => {
    const tok = normalizeToken(e.token);
    const raw = parseFloat(String(e.amount)) || 0;
    const human = tok.decimals > 0 ? raw / Math.pow(10, tok.decimals) : raw;
    map.set(tok.symbol, (map.get(tok.symbol) || 0) + human);
    return map;
  }, new Map<string, number>());

  const totalSummary = Array.from(tokenTotals.entries())
    .map(([sym, amt]) => `${abbr(amt)} ${sym}`)
    .join(' + ');

  // Date span
  const timestamps = edges
    .map((e) => parseTimestamp(e.timestamp))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const oldest = timestamps[0];
  const newest = timestamps[timestamps.length - 1];
  const fmtDate = (d: Date) =>
    d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-ink-muted uppercase">
          {HEADER_LABELS[headerKind]}
        </h4>
        {tokenChip && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300">
            {tokenChip}
          </span>
        )}
      </div>

      {/* Title — editable or static */}
      {editableLabel ? (
        editingLabel ? (
          <input
            autoFocus
            type="text"
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') setEditingLabel(false);
            }}
            placeholder={staticTitle}
            className="w-full bg-surface-raised/50 border border-brand rounded px-2 py-0.5 text-sm font-semibold text-ink placeholder-ink-faint focus:outline-none"
          />
        ) : (
          <p
            className="text-sm font-semibold text-ink cursor-pointer hover:text-brand transition-colors"
            onClick={() => setEditingLabel(true)}
            title="Click to rename"
          >
            {editableLabel.value || staticTitle}
          </p>
        )
      ) : (
        <p className="text-sm font-semibold text-ink">{staticTitle}</p>
      )}

      {/* Totals card */}
      <div className="bg-brand-soft rounded p-3 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-ink-muted">Total amount</span>
          <span className="text-ink font-semibold">{totalSummary}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-ink-muted">Transactions</span>
          <span className="text-ink">{edges.length}</span>
        </div>
        {oldest && newest && (
          <div className="flex justify-between text-xs">
            <span className="text-ink-muted">Date span</span>
            <span className="text-ink">
              {fmtDate(oldest)}
              {oldest.getTime() !== newest.getTime() ? ` — ${fmtDate(newest)}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Color picker (bundle only) */}
      {onColorChange && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Color</h4>
          <GroupColorPicker color={color} onChange={(c) => onColorChange(c ?? '')} />
        </div>
      )}

      {/* Individual transactions */}
      {edges.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-[10px] font-semibold text-ink-faint uppercase">Transactions</h5>
          <div className="max-h-40 overflow-y-auto overflow-x-hidden rounded bg-black/30 divide-y divide-line-strong/20 [scrollbar-width:thin]">
            {edges.map((e) => {
              const tok = normalizeToken(e.token);
              const human =
                tok.decimals > 0
                  ? parseFloat(String(e.amount)) / Math.pow(10, tok.decimals)
                  : parseFloat(String(e.amount));
              const explorerUrl = buildTxExplorerUrl(e.chain, e.txHash || '');
              const HashTag = explorerUrl ? 'a' : 'span';
              const confirming = confirmDeleteId === e.id;
              return (
                <div
                  key={e.id}
                  className="flex items-center justify-between text-[11px] text-ink-muted px-2 py-1.5 hover:bg-surface-raised/70 hover:text-ink transition-colors group"
                >
                  <HashTag
                    {...(explorerUrl
                      ? { href: explorerUrl, target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    className="font-mono truncate max-w-[120px] hover:text-amber-300 flex items-center gap-1"
                  >
                    {e.txHash?.slice(0, 10)}…
                    {explorerUrl && (
                      <FaArrowUpRightFromSquare size={8} className="opacity-0 group-hover:opacity-60 shrink-0" />
                    )}
                  </HashTag>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-ink">
                      {abbr(human)} {tok.symbol}
                    </span>
                    {onDeleteTransaction && (
                      confirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { onDeleteTransaction(e.id); setConfirmDeleteId(null); }}
                            className="p-1 rounded text-red-400 hover:bg-red-600/30 transition-colors"
                            title="Confirm delete"
                          >
                            <FaCheck size={9} />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="p-1 rounded text-ink-faint hover:bg-surface-raised hover:text-ink transition-colors"
                            title="Cancel"
                          >
                            <FaXmark size={9} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(e.id)}
                          className="p-1 rounded text-ink-faint opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                          title="Delete transaction"
                        >
                          <FaTrash size={9} />
                        </button>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Arc controls */}
      {onArcEdge && (
        <div>
          <h4 className="text-xs font-semibold text-ink-muted uppercase mb-1">Arc</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onArcEdge(-40)}
              className="flex-1 py-1 rounded text-sm border border-line-strong text-ink-muted hover:border-line-strong hover:text-ink transition-colors"
              title="Arc left"
            >
              ◁
            </button>
            <button
              onClick={() => onArcEdge(null)}
              className="px-2 py-1 rounded text-xs border border-line-strong text-ink-faint hover:border-line-strong hover:text-ink-muted transition-colors"
              title="Reset arc"
            >
              Reset
            </button>
            <button
              onClick={() => onArcEdge(40)}
              className="flex-1 py-1 rounded text-sm border border-line-strong text-ink-muted hover:border-line-strong hover:text-ink transition-colors"
              title="Arc right"
            >
              ▷
            </button>
          </div>
        </div>
      )}

      {/* Footer actions slot */}
      {actions && <div>{actions}</div>}
    </div>
  );
}
