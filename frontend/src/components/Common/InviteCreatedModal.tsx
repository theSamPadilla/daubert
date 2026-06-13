'use client';

import { useState } from 'react';
import { FaCopy, FaCheck, FaTriangleExclamation } from 'react-icons/fa6';
import { Modal, Button } from '@/components/ui';

interface InviteCreatedModalProps {
  email: string;
  link: string;
  onClose: () => void;
}

export function InviteCreatedModal({ email, link, onClose }: InviteCreatedModalProps) {
  const [copied, setCopied] = useState(false);

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
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-xl"
      footer={
        <div className="text-center">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
            <FaTriangleExclamation className="w-3 h-3" />
            No email sent automatically
          </div>
          <h3 className="text-xl font-semibold text-ink tracking-tight">Invite link is ready</h3>
          <p className="text-sm text-ink-muted leading-relaxed max-w-md mx-auto">
            Copy the link below and send it to{' '}
            <span className="text-ink font-medium">{email}</span>
            <br />
            The link is single-use and tied to their email.
          </p>
        </div>

        {/* Link block with inline copy */}
        <div className="flex items-stretch gap-0 rounded-xl border border-line-strong bg-surface overflow-hidden focus-within:border-brand/60 transition-colors">
          <div className="flex-1 min-w-0 px-4 py-3.5 font-mono text-sm text-ink-muted truncate select-all">
            {link}
          </div>
          <button
            type="button"
            onClick={copy}
            className={`flex items-center justify-center gap-2 px-5 text-sm font-medium transition-all whitespace-nowrap border-l focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              copied
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-brand text-white border-brand hover:bg-brand-strong'
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

        {/* Footer note */}
        <p className="text-xs text-ink-faint leading-relaxed text-center">
          Only <span className="text-ink-muted">{email}</span> can use this link to join.
        </p>
      </div>
    </Modal>
  );
}
