import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onAddAddress: () => void;
  onAddTransaction: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
}

export function Header({
  investigation,
  onAddAddress,
  onAddTransaction,
  onUndo,
  canUndo,
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
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded text-sm transition-colors"
            >
              ↩ Undo
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
