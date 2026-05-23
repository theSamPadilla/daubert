'use client';

import { useState } from 'react';
import { FaXmark } from 'react-icons/fa6';

interface CitationPickerProps {
  onInsert: (citation: { type: string; label: string; url: string }) => void;
  onClose: () => void;
}

export function CitationPicker({ onInsert, onClose }: CitationPickerProps) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  const handleInsert = () => {
    if (!url.trim() || !label.trim()) return;
    onInsert({ type: 'external', label: label.trim(), url: url.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-panel border border-line-strong rounded-lg shadow-xl w-96 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-ink">Insert Citation</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-muted">
            <FaXmark className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-ink-muted mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Etherscan Transaction 0x1234..."
              className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-brand"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">URL</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://etherscan.io/tx/0x..."
              className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-ink font-mono focus:outline-none focus:border-brand"
              onKeyDown={(e) => { if (e.key === 'Enter') handleInsert(); }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleInsert}
            disabled={!url.trim() || !label.trim()}
            className="px-3 py-1.5 rounded text-sm bg-brand hover:bg-brand/90 text-white disabled:opacity-50"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
