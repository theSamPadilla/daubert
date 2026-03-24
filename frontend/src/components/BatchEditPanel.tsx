import { useState } from 'react';

const COLOR_PRESETS = [
  '#3b82f6', '#10b981', '#ef4444', '#f97316',
  '#8b5cf6', '#ec4899', '#06b6d4', '#eab308',
];

interface BatchEditPanelProps {
  count: number;
  onRename: (prefix: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onExtractToTrace?: () => void;
}

export function BatchEditPanel({ count, onRename, onRecolor, onDelete, onDeselect, onExtractToTrace }: BatchEditPanelProps) {
  const [prefix, setPrefix] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">{count} nodes selected</span>
        <button onClick={onDeselect} className="text-xs text-gray-400 hover:text-white">
          Deselect
        </button>
      </div>

      {/* Rename All */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Rename All</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="Prefix..."
            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => { if (prefix.trim()) { onRename(prefix.trim()); setPrefix(''); } }}
            disabled={!prefix.trim()}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 rounded text-xs text-white"
          >
            Apply
          </button>
        </div>
        <p className="text-[10px] text-gray-500 mt-1">Generates &quot;Prefix 1&quot;, &quot;Prefix 2&quot;, etc.</p>
      </div>

      {/* Change Color */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Change Color</h4>
        <div className="flex gap-2 flex-wrap">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              onClick={() => onRecolor(color)}
              className="w-6 h-6 rounded-full border-2 border-transparent hover:border-white transition-transform hover:scale-110"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Extract to New Trace */}
      {onExtractToTrace && (
        <div>
          <button
            onClick={onExtractToTrace}
            className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 hover:text-indigo-200 rounded text-xs w-full text-left"
          >
            Extract {count} nodes to new trace
          </button>
          <p className="text-[10px] text-gray-500 mt-1">
            Aggregates cross-boundary connections into a single edge.
          </p>
        </div>
      )}

      {/* Delete All */}
      <div className="pt-2 border-t border-gray-700">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-400">Delete {count} nodes?</span>
            <button
              onClick={() => { onDelete(); setConfirmDelete(false); }}
              className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs text-white"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 rounded text-xs w-full"
          >
            Delete {count} nodes
          </button>
        )}
      </div>
    </div>
  );
}
