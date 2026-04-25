import { useState, useRef, useEffect } from 'react';
import { FaRotateLeft, FaArrowsRotate, FaDownload, FaChevronDown } from 'react-icons/fa6';
import { Investigation } from '../types/investigation';

interface HeaderProps {
  investigation: Investigation | null;
  onAddAddress: () => void;
  onAddTransaction: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onRefresh?: () => void;
  onExport?: (format: 'png' | 'pdf') => void;
  rightContent?: React.ReactNode;
}

export function Header({
  investigation,
  onAddAddress,
  onAddTransaction,
  onUndo,
  canUndo,
  onRefresh,
  onExport,
  rightContent,
}: HeaderProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportOpen]);

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

            {/* Export dropdown */}
            <div ref={exportRef} className="relative">
              <div className="flex">
                <button
                  onClick={() => onExport?.('png')}
                  title="Export as PNG"
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-l text-sm transition-colors flex items-center gap-1.5"
                >
                  <FaDownload size={12} /> Export
                </button>
                <button
                  onClick={() => setExportOpen((o) => !o)}
                  className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-r border-l border-gray-600 text-sm transition-colors"
                >
                  <FaChevronDown size={10} />
                </button>
              </div>
              {exportOpen && (
                <div className="absolute right-0 mt-1 w-36 bg-gray-700 border border-gray-600 rounded shadow-lg z-50 overflow-hidden">
                  <button
                    onClick={() => { onExport?.('png'); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 transition-colors flex items-center gap-2"
                  >
                    <FaDownload size={11} /> PNG Image
                  </button>
                  <button
                    onClick={() => { onExport?.('pdf'); setExportOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 transition-colors flex items-center gap-2"
                  >
                    <FaDownload size={11} /> PDF (Print)
                  </button>
                </div>
              )}
            </div>

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
        {rightContent}
      </div>
    </header>
  );
}
