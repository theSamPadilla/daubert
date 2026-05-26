'use client';

import { useEffect, useRef, useState } from 'react';
import { type ColumnDef, slugifyColumnLabel } from '@/lib/chronologySchema';

interface AddColumnModalProps {
  open: boolean;
  existingColumns: ColumnDef[];
  onAdd: (column: ColumnDef, index?: number) => void;
  onCancel: () => void;
}

// `placement` is one of: 'end' | 'start' | `after:${columnKey}`.
type Placement = string;

export function AddColumnModal({
  open,
  existingColumns,
  onAdd,
  onCancel,
}: AddColumnModalProps) {
  const [label, setLabel] = useState('');
  const [placement, setPlacement] = useState<Placement>('end');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLabel('');
    setPlacement('end');
    setError(null);
    // Defer focus until after the modal mounts.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = label.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    let key: string;
    try {
      key = slugifyColumnLabel(trimmed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    // Uniquify key against existing ones.
    const existingKeys = existingColumns.map((c) => c.key);
    let unique = key;
    let n = 1;
    while (existingKeys.includes(unique)) {
      unique = `${key}_${++n}`;
    }
    // Resolve placement to an index (undefined = append at end).
    let index: number | undefined;
    if (placement === 'end') {
      index = undefined;
    } else if (placement === 'start') {
      index = 0;
    } else if (placement.startsWith('after:')) {
      const targetKey = placement.slice('after:'.length);
      const i = existingColumns.findIndex((c) => c.key === targetKey);
      index = i >= 0 ? i + 1 : undefined;
    }
    onAdd({ key: unique, label: trimmed, width: 10, kind: 'text' }, index);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-panel rounded-lg p-6 w-[440px] border border-line-strong shadow-xl">
        <h3 className="text-sm font-semibold text-ink uppercase tracking-wider mb-4">
          Add column
        </h3>

        <label className="block text-xs text-ink-muted mb-1.5">Column name</label>
        <input
          ref={inputRef}
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder='e.g. "Amount", "Counterparty", "Exhibit #"'
          className="w-full bg-surface border border-line-strong rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand"
          autoComplete="off"
          spellCheck={false}
        />
        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}

        <label className="block text-xs text-ink-muted mt-4 mb-1.5">Placement</label>
        <select
          value={placement}
          onChange={(e) => setPlacement(e.target.value)}
          className="w-full bg-surface border border-line-strong rounded px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand"
        >
          <option value="end">At the end</option>
          <option value="start">At the beginning</option>
          {existingColumns.map((c) => (
            <option key={c.key} value={`after:${c.key}`}>
              After &ldquo;{c.label}&rdquo;
            </option>
          ))}
        </select>

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1.5 bg-brand hover:bg-brand/90 disabled:opacity-40 disabled:cursor-not-allowed rounded text-sm text-white transition-colors"
          >
            Add column
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 bg-surface-raised hover:bg-surface-raised rounded text-sm text-ink-muted ml-auto transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
