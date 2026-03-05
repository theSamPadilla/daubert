import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onAddAddress: () => void;
  onAddTransaction: () => void;
}

export function Header({
  investigation,
  onAddAddress,
  onAddTransaction,
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
