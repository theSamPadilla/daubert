'use client';

import { useState, useRef, useEffect } from 'react';
import { FaFileArrowDown, FaSpinner } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';

type Format = 'pdf' | 'docx';

interface Props {
  conversationId: string;
  title: string | null;
  createdAt: string;
  disabled?: boolean;
  /** Extra classes for the icon button (e.g. hover-reveal in list rows). */
  buttonClassName?: string;
  /** Optional controlled open state, so another element can open the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Open the menu above the button (for rows near the bottom of a scroll area). */
  menuPlacement?: 'down' | 'up';
}

export default function ConversationExportMenu({
  conversationId,
  title,
  createdAt,
  disabled,
  buttonClassName = '',
  open: openProp,
  onOpenChange,
  menuPlacement = 'down',
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenState(false);
        onOpenChange?.(false);
        setError(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onOpenChange]);

  async function run(format: Format) {
    setOpen(false);
    setError(null);
    setBusy(true);
    try {
      await apiClient.exportConversation(conversationId, format, title, createdAt);
    } catch {
      setError('Export failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative shrink-0" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled || busy}
        aria-label="Export conversation"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export conversation"
        className={`h-8 w-8 inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-raised rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-muted ${buttonClassName} ${busy || error ? '!opacity-100' : ''}`}
      >
        {busy ? <FaSpinner className="w-3.5 h-3.5 animate-spin" /> : <FaFileArrowDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 ${menuPlacement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} w-40 bg-surface rounded-xl border border-line shadow-[0_24px_60px_-30px_rgba(11,18,32,0.18)] z-20 py-1`}
        >
          <button
            role="menuitem"
            onClick={() => run('pdf')}
            className="w-full text-left text-sm text-ink-soft hover:bg-surface-raised rounded-lg px-3 py-1.5 transition-colors"
          >
            Export as PDF
          </button>
          <button
            role="menuitem"
            onClick={() => run('docx')}
            className="w-full text-left text-sm text-ink-soft hover:bg-surface-raised rounded-lg px-3 py-1.5 transition-colors"
          >
            Export as DOCX
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={`absolute right-0 ${menuPlacement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} w-40 text-xs text-redline bg-surface border border-line rounded-lg px-2 py-1 z-20`}>
          {error}
        </p>
      )}
    </div>
  );
}
