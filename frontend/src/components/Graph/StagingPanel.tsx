import { useState } from 'react';
import { TransactionEdge, Trace } from '@/types/investigation';
import { formatTokenAmount } from '@/utils/formatAmount';
import { classifyBtcRow } from '@/utils/btcRowDisplay';
import { classifySolanaRow } from '@/utils/classifySolanaRow';
import { ChangeBadge } from '@/components/Graph/details/UtxoBreakdown';
import { evidenceTitle } from '@/utils/utxoDisplay';

interface StagingPanelProps {
  items: TransactionEdge[];
  traces: Trace[];
  onAddToTrace: (traceId: string, selected: TransactionEdge[]) => void;
  onClear: () => void;
}

function truncateAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const CHIP_CLASS = 'px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap';

/**
 * Bitcoin-only row badges for a staged item. Staged rows carry no
 * fetched-address context (StagingPanel.items is a flat TransactionEdge[]
 * with no accompanying "fetched for address X" metadata — see
 * useWalletTransactionAuthoring / WorkspaceModals), so direction (in/out/self)
 * can't be determined here and is intentionally omitted. The direction-
 * agnostic badges (in/out counts, change?, junction) don't need an address
 * and are shown as-is.
 */
function BtcBadges({ item }: { item: TransactionEdge }) {
  const info = classifyBtcRow(item, '');
  if (!info) return null;
  return (
    <span className="flex items-center gap-1">
      <span className={`${CHIP_CLASS} bg-canvas-fill text-canvas-muted border border-canvas-line`}>
        {info.inCount} in / {info.outCount} out
      </span>
      {info.isChange && <ChangeBadge evidence={info.changeEvidence} />}
      {info.isJunction && (
        <span className={`${CHIP_CLASS} bg-indigo-500/20 text-indigo-300`}>junction</span>
      )}
    </span>
  );
}

/**
 * Solana-only row badges for a staged item. Same address-less context as
 * BtcBadges above (no "fetched for address X" metadata on staged rows), so
 * direction is omitted here too — only the address-agnostic spam? flag is
 * shown.
 */
function SolBadges({ item }: { item: TransactionEdge }) {
  const info = classifySolanaRow(item, '');
  if (!info) return null;
  return (
    <span className="flex items-center gap-1">
      {info.isSpam && (
        <span
          className={`${CHIP_CLASS} bg-amber-500/20 text-amber-300`}
          title={evidenceTitle(info.evidence)}
        >
          spam?
        </span>
      )}
    </span>
  );
}

export function StagingPanel({ items, traces, onAddToTrace, onClear }: StagingPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetTrace, setTargetTrace] = useState(traces[0]?.id || '');

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const handleAdd = () => {
    if (!targetTrace || selected.size === 0) return;
    const selectedItems = items.filter((i) => selected.has(i.id));
    onAddToTrace(targetTrace, selectedItems);
    setSelected(new Set());
  };

  if (items.length === 0) return null;

  return (
    <div className="border-t border-canvas-line flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-canvas-line">
        <h3 className="text-xs font-semibold text-canvas-muted uppercase">
          Staging ({items.length} results)
        </h3>
        <button onClick={onClear} className="text-xs text-canvas-muted hover:text-canvas-ink">
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto max-h-60">
        <div className="px-4 py-1">
          <label className="flex items-center gap-2 text-xs text-canvas-muted cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === items.length}
              onChange={toggleAll}
              className="rounded bg-canvas-fill border-canvas-line"
            />
            Select all
          </label>
        </div>
        {items.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-2 px-4 py-1.5 hover:bg-canvas-fill cursor-pointer text-xs"
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggleItem(item.id)}
              className="rounded bg-canvas-fill border-canvas-line"
            />
            <span className="font-mono text-canvas-muted">{truncateAddr(item.from)}</span>
            <span className="text-canvas-muted">-&gt;</span>
            <span className="font-mono text-canvas-muted">{truncateAddr(item.to)}</span>
            <BtcBadges item={item} />
            <SolBadges item={item} />
            <span className="ml-auto text-canvas-muted">
              {formatTokenAmount(item.amount, item.token.decimals)} {item.token.symbol}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-canvas-line">
        <select
          value={targetTrace}
          onChange={(e) => setTargetTrace(e.target.value)}
          className="flex-1 bg-canvas-fill border border-canvas-line rounded-lg text-canvas-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 px-2 py-1 text-xs"
        >
          {traces.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          disabled={selected.size === 0 || !targetTrace}
          className="px-3 py-1 bg-brand text-white hover:bg-brand-strong disabled:bg-canvas-fill disabled:text-canvas-muted rounded-lg text-xs"
        >
          Add {selected.size > 0 ? `(${selected.size})` : ''} to Trace
        </button>
      </div>
    </div>
  );
}
