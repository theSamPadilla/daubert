'use client';

import { FaXmark } from 'react-icons/fa6';

export function Banner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 mb-6 rounded-lg border border-redline/30 bg-redline/5 text-redline text-sm">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="hover:text-redline/70 transition-colors">
        <FaXmark size={14} />
      </button>
    </div>
  );
}
