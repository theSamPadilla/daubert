import { Investigation } from '../types/investigation';
import { CHAIN_CONFIGS } from '../services/types';

interface HeaderProps {
  investigation: Investigation | null;
  activeChain: string;
  onBack?: () => void;
  onOpen: () => void;
  onSave: () => void;
  onImport: () => void;
  onChainChange: (chain: string) => void;
  onAddWallet: () => void;
  onAddTransaction: () => void;
}

export function Header({
  investigation,
  activeChain,
  onBack,
  onOpen,
  onSave,
  onImport,
  onChainChange,
  onAddWallet,
  onAddTransaction,
}: HeaderProps) {
  return (
    <header className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
          >
            &larr; Cases
          </button>
        )}
        <h1 className="text-xl font-semibold">
          {investigation?.name || 'Daubert'}
        </h1>
      </div>

      <div className="flex gap-2 items-center">
        {investigation && (
          <>
            <button
              onClick={onAddWallet}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            >
              + Wallet
            </button>
            <button
              onClick={onAddTransaction}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
            >
              + Transaction
            </button>
            <div className="w-px h-6 bg-gray-600" />
          </>
        )}
        <select
          value={activeChain}
          onChange={(e) => onChainChange(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm"
        >
          {Object.values(CHAIN_CONFIGS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="w-px h-6 bg-gray-600" />
        <button
          onClick={onOpen}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >
          Open
        </button>
        <button
          onClick={onImport}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >
          Import
        </button>
        <button
          onClick={onSave}
          disabled={!investigation}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition-colors"
        >
          Export
        </button>
      </div>
    </header>
  );
}
