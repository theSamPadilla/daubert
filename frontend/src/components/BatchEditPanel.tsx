import { useState } from 'react';
import { FaLayerGroup, FaArrowUpRightFromSquare, FaObjectGroup } from 'react-icons/fa6';

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
  onGroupNodes?: (name: string) => void;
  onAddToGroup?: { groupName: string; onConfirm: () => void };
}

export function BatchEditPanel({ count, onRename, onRecolor, onDelete, onDeselect, onExtractToTrace, onGroupNodes, onAddToGroup }: BatchEditPanelProps) {
  const [prefix, setPrefix] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [groupName, setGroupName] = useState('');

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
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

      {/* ── Structural actions ─────────────────────────────────────────── */}
      {(onGroupNodes || onExtractToTrace || onAddToGroup) && (
        <div className="pt-3 border-t border-gray-700 space-y-2">
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Organize</h4>

          {/* Add to existing group */}
          {onAddToGroup && (
            <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <FaObjectGroup size={12} className="text-teal-400 shrink-0" />
                <span className="text-xs font-semibold text-teal-300">Add to group</span>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Add the selected nodes to <span className="text-teal-300 font-medium">{onAddToGroup.groupName}</span>.
              </p>
              <button
                onClick={onAddToGroup.onConfirm}
                className="w-full px-3 py-1.5 bg-teal-600/30 hover:bg-teal-600/50 text-teal-200 rounded text-xs font-medium transition-colors"
              >
                Add {count - 1} node{count - 1 !== 1 ? 's' : ''} to &quot;{onAddToGroup.groupName}&quot;
              </button>
            </div>
          )}


          {/* Group — within this trace */}
          {onGroupNodes && (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <FaLayerGroup size={12} className="text-violet-400 shrink-0" />
                <span className="text-xs font-semibold text-violet-300">Group within trace</span>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Visually cluster these nodes inside a named group. Stays in the same trace.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && groupName.trim()) { onGroupNodes(groupName.trim()); setGroupName(''); } }}
                  placeholder="Group name..."
                  className="flex-1 bg-gray-800 border border-violet-500/40 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-400"
                />
                <button
                  onClick={() => { if (groupName.trim()) { onGroupNodes(groupName.trim()); setGroupName(''); } }}
                  disabled={!groupName.trim()}
                  className="px-3 py-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-xs text-white"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {/* Extract — moves nodes to a new trace */}
          {onExtractToTrace && (
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <FaArrowUpRightFromSquare size={11} className="text-indigo-400 shrink-0" />
                <span className="text-xs font-semibold text-indigo-300">Extract to new trace</span>
              </div>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Moves these nodes into a brand-new trace. Cross-boundary edges are aggregated.
              </p>
              <button
                onClick={onExtractToTrace}
                className="w-full px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 rounded text-xs font-medium transition-colors"
              >
                Extract {count} nodes
              </button>
            </div>
          )}
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
