import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
}

export function Header({ investigation, onNew, onOpen, onSave }: HeaderProps) {
  return (
    <header className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
      <h1 className="text-xl font-semibold">
        {investigation?.name || 'Onchain Transaction Tracker'}
      </h1>

      <div className="flex gap-2">
        <button
          onClick={onNew}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >
          New
        </button>
        <button
          onClick={onOpen}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
        >
          Open
        </button>
        <button
          onClick={onSave}
          disabled={!investigation}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition-colors"
        >
          Save
        </button>
      </div>
    </header>
  );
}
