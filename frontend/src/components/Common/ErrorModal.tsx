'use client';
import { useEffect } from 'react';
import { FaTriangleExclamation } from 'react-icons/fa6';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
}

export function ErrorModal({ open, title = 'Something went wrong', message, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface-panel rounded-lg p-6 w-[480px] border border-line-strong shadow-xl">
        <div className="flex items-start gap-3 mb-3">
          <span className="mt-0.5 text-red-400 shrink-0">
            <FaTriangleExclamation size={18} />
          </span>
          <h3 className="text-sm font-semibold text-ink uppercase tracking-wider">{title}</h3>
        </div>

        <div className="text-sm text-ink-muted leading-relaxed mb-5 whitespace-pre-wrap break-words">
          {message}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-8 rounded bg-surface-raised hover:bg-surface-raised/80 text-ink text-sm transition-colors"
            autoFocus
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
