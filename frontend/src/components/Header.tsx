import { FaRotateLeft, FaArrowsRotate } from 'react-icons/fa6';
import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onAddAddress: () => void;
  onAddTransaction: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onRefresh?: () => void;
}

export function Header({
  investigation,
  onAddAddress,
  onAddTransaction,
  onUndo,
  canUndo,
  onRefresh,
}: HeaderProps) {
  return (
    <header className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {investigation?.name || 'Daubert'}
        </h1>
      </div>

      <div className="flex gap-2 items-center">
        {investigation && (
          <>
            <button
              onClick={onRefresh}
              title="Refresh"
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors flex items-center gap-1.5"
            >
              <FaArrowsRotate size={12} /> Refresh
            </button>
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded text-sm transition-colors flex items-center gap-1.5"
            >
              <FaRotateLeft size={12} /> Undo
            </button>
            <button
              onClick={onAddAddress}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            >
              + Address
            </button>
            <button
              onClick={onAddTransaction}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            >
              + Transaction
            </button>
          </>
        )}
      </div>
    </header>
  );
}
