import { FaCodeBranch } from 'react-icons/fa6';

interface EdgeBatchPanelProps {
  count: number;
  onBundle: () => void;
  onDeselect: () => void;
}

export function EdgeBatchPanel({ count, onBundle, onDeselect }: EdgeBatchPanelProps) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white">{count} edges selected</span>
        <button onClick={onDeselect} className="text-xs text-gray-400 hover:text-white">
          Deselect
        </button>
      </div>

      <div className="pt-1 border-t border-gray-700 space-y-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Organize</h4>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <FaCodeBranch size={12} className="text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-300">Bundle edges</span>
          </div>
          <p className="text-[10px] text-gray-400 leading-relaxed">
            Group edges by direction and token. Each direction&thinsp;&times;&thinsp;token pair
            collapses into one edge showing the total amount and transaction count.
          </p>
          <button
            onClick={onBundle}
            className="w-full px-3 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 rounded text-xs font-medium transition-colors"
          >
            Bundle {count} edges
          </button>
        </div>
      </div>
    </div>
  );
}
