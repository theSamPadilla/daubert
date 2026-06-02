'use client';

import { useEffect, useState } from 'react';
import { FaCopy, FaCheck, FaTriangleExclamation } from 'react-icons/fa6';

interface InviteCreatedModalProps {
  email: string;
  link: string;
  onClose: () => void;
}

export function InviteCreatedModal({ email, link, onClose }: InviteCreatedModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — silent
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative bg-surface-panel rounded-2xl w-full max-w-xl border border-line-strong shadow-2xl p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-medium">
            <FaTriangleExclamation className="w-3 h-3" />
            No email sent automatically
          </div>
          <h3 className="text-2xl font-semibold text-white tracking-tight">Invite link is ready</h3>
          <p className="text-sm text-ink-muted leading-relaxed max-w-md mx-auto">
            Copy the link below and send it to{' '}
            <span className="text-white font-medium">{email}</span>
            <br />
            The link is single-use and tied to their email.
          </p>
        </div>

        {/* Link block with inline copy */}
        <div className="flex items-stretch gap-0 rounded-xl border border-line-strong bg-surface overflow-hidden focus-within:border-brand/60 transition-colors">
          <div className="flex-1 min-w-0 px-4 py-3.5 font-mono text-sm text-white truncate select-all">
            {link}
          </div>
          <button
            type="button"
            onClick={copy}
            className={`flex items-center justify-center gap-2 px-5 text-sm font-medium transition-all whitespace-nowrap border-l ${
              copied
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-brand text-white border-brand hover:bg-brand/90'
            }`}
          >
            {copied ? (
              <>
                <FaCheck size={13} />
                Copied
              </>
            ) : (
              <>
                <FaCopy size={13} />
                Copy
              </>
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="text-center space-y-4">
          <p className="text-xs text-ink-faint leading-relaxed">
            Only <span className="text-ink-muted">{email}</span> can use this link to join.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-lg bg-surface-raised hover:bg-surface-raised/80 text-sm font-medium text-ink-muted hover:text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
