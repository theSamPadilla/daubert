'use client';

import { FaDownload } from 'react-icons/fa6';
import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onExportClick: () => void;
  rightContent?: React.ReactNode;
}

export function Header({
  investigation,
  onExportClick,
  rightContent,
}: HeaderProps) {
  return (
    <header className="bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between gap-4">
      <h1 className="text-xl font-semibold shrink-0">
        {investigation?.name || 'Daubert'}
      </h1>

      <div className="flex gap-2 items-center shrink-0">
        {investigation && (
          <button
            onClick={onExportClick}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors flex items-center gap-1.5"
          >
            <FaDownload size={12} /> Export
          </button>
        )}
        {rightContent}
      </div>
    </header>
  );
}
