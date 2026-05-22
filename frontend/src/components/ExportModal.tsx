import { useEffect } from 'react';
import { FaImage, FaFilePdf } from 'react-icons/fa6';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  onExport: (format: 'png' | 'pdf') => void;
}

export function ExportModal({ open, onClose, onExport }: ExportModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleExport = (format: 'png' | 'pdf') => {
    onExport(format);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg p-6 w-[400px]">
        <h3 className="text-sm font-semibold text-gray-300 uppercase mb-5">
          Export Graph
        </h3>
        <div className="flex gap-3">
          {/* PNG */}
          <button
            onClick={() => handleExport('png')}
            className="flex-1 flex flex-col items-center gap-2 px-4 py-5 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            <FaImage size={28} />
            <span className="text-sm font-semibold">PNG Image</span>
            <span className="text-xs text-blue-200 text-center leading-snug">
              Best for sharing on the web
            </span>
          </button>

          {/* PDF */}
          <button
            onClick={() => handleExport('pdf')}
            className="flex-1 flex flex-col items-center gap-2 px-4 py-5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            <FaFilePdf size={28} />
            <span className="text-sm font-semibold">PDF (Print)</span>
            <span className="text-xs text-gray-400 text-center leading-snug">
              Best for printing or reports
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
