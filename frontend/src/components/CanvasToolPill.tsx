import { FaArrowsRotate, FaRotateLeft, FaRotateRight } from 'react-icons/fa6';

interface CanvasToolPillProps {
  onRefresh: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onRedo: () => void;
  canRedo: boolean;
}

export function CanvasToolPill({
  onRefresh,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
}: CanvasToolPillProps) {
  return (
    <div className="absolute top-3 left-3 z-20 bg-gray-800/90 border border-gray-700 rounded-full shadow-lg flex items-center gap-1 px-1.5 py-1">
      <button
        onClick={onRefresh}
        title="Refresh"
        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-700 transition-colors text-gray-300 hover:text-white"
      >
        <FaArrowsRotate size={13} />
      </button>

      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-700 transition-colors text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
      >
        <FaRotateLeft size={13} />
      </button>

      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-700 transition-colors text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-300"
      >
        <FaRotateRight size={13} />
      </button>
    </div>
  );
}
