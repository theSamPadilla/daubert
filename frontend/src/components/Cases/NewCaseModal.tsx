'use client';

import { useEffect, useState } from 'react';
import { FaPlus, FaTrash, FaXmark } from 'react-icons/fa6';
import { apiClient, type Case } from '@/lib/api-client';

interface NewCaseModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (created: Case) => void;
}

export function NewCaseModal({ open, onClose, onCreated }: NewCaseModalProps) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [links, setLinks] = useState<{ url: string; label: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const addLink = () => setLinks((prev) => [...prev, { url: '', label: '' }]);
  const removeLink = (i: number) => setLinks((prev) => prev.filter((_, idx) => idx !== i));
  const updateLink = (i: number, field: 'url' | 'label', value: string) =>
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setError(null);
      const created = await apiClient.createCase({
        name: name.trim(),
        startDate: startDate || undefined,
        links: links.filter((l) => l.url.trim() && l.label.trim()),
      });
      onCreated?.(created);
      onClose();
      // Reset form for next open
      setName(''); setStartDate(''); setLinks([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create case');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface-panel border border-line-strong rounded-lg shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-strong">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">New case</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-white transition-colors"
            aria-label="Close"
          >
            <FaXmark size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-3 px-4 py-3 rounded border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="hover:text-white transition-colors"
              >
                <FaXmark size={13} />
              </button>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1.5">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !submitting) handleSubmit(); }}
              placeholder="e.g. FTX Investigation"
              className="w-full bg-surface border border-line-strong rounded px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand"
              autoFocus
            />
          </div>

          {/* Start date */}
          <div>
            <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1.5">
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded border border-line-strong bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>

          {/* Links */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-ink-muted uppercase tracking-wider">
                Links
              </label>
              <button
                type="button"
                onClick={addLink}
                className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors"
              >
                <FaPlus size={10} /> Add link
              </button>
            </div>
            {links.length > 0 && (
              <div className="space-y-2">
                {links.map((link, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="url"
                      placeholder="https://..."
                      value={link.url}
                      onChange={(e) => updateLink(i, 'url', e.target.value)}
                      className="flex-1 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand"
                    />
                    <input
                      type="text"
                      placeholder="Label"
                      value={link.label}
                      onChange={(e) => updateLink(i, 'label', e.target.value)}
                      className="w-28 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand"
                    />
                    <button
                      type="button"
                      onClick={() => removeLink(i)}
                      className="text-ink-muted hover:text-red-400 transition-colors"
                      aria-label="Remove link"
                    >
                      <FaTrash size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line-strong">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim() || submitting}
            className="px-3 py-1.5 rounded text-sm bg-brand hover:bg-brand/90 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Creating...' : 'Create case'}
          </button>
        </div>
      </div>
    </div>
  );
}
