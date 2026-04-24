import { useState } from 'react';
import { TransactionEdge, Trace } from '../types/investigation';

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

function formatAmount(amount: string, decimals: number): string {
  if (!amount || amount === '0') return '0';
  const num = Number(amount);
  if (isNaN(num)) return amount;
  const adjusted = num / Math.pow(10, decimals);
  if (adjusted < 0.001) return '<0.001';
  if (adjusted >= 1e12) return `${(adjusted / 1e12).toFixed(2).replace(/\.?0+$/, '')}T`;
  if (adjusted >= 1e9) return `${(adjusted / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (adjusted >= 1e6) return `${(adjusted / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (adjusted >= 1e3) return `${(adjusted / 1e3).toFixed(2).replace(/\.?0+$/, '')}K`;
  return adjusted.toLocaleString(undefined, { maximumFractionDigits: 4 });
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
    <div className="border-t border-gray-700 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <h3 className="text-xs font-semibold text-gray-400 uppercase">
          Staging ({items.length} results)
        </h3>
        <button onClick={onClear} className="text-xs text-gray-500 hover:text-gray-300">
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto max-h-60">
        <div className="px-4 py-1">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size === items.length}
              onChange={toggleAll}
              className="rounded bg-gray-900 border-gray-600"
            />
            Select all
          </label>
        </div>
        {items.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-2 px-4 py-1.5 hover:bg-gray-700 cursor-pointer text-xs"
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => toggleItem(item.id)}
              className="rounded bg-gray-900 border-gray-600"
            />
            <span className="font-mono text-gray-400">{truncateAddr(item.from)}</span>
            <span className="text-gray-500">-&gt;</span>
            <span className="font-mono text-gray-400">{truncateAddr(item.to)}</span>
            <span className="ml-auto text-gray-300">
              {formatAmount(item.amount, item.token.decimals)} {item.token.symbol}
            </span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-700">
        <select
          value={targetTrace}
          onChange={(e) => setTargetTrace(e.target.value)}
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs"
        >
          {traces.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          disabled={selected.size === 0 || !targetTrace}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs"
        >
          Add {selected.size > 0 ? `(${selected.size})` : ''} to Trace
        </button>
      </div>
    </div>
  );
}
