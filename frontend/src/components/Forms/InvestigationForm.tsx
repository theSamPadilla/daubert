import { useState } from 'react';
import { type Investigation, type Trace } from '@/lib/api-client';

interface InvestigationFormProps {
  investigation: Investigation;
  traces?: Trace[];
  onSave: (updates: { name: string; notes: string }) => void;
  onDelete: () => void;
  onCancel: () => void;
  onDuplicate?: () => void | Promise<void>;
}

export function InvestigationForm({ investigation, traces, onSave, onDelete, onCancel, onDuplicate }: InvestigationFormProps) {
  const [name, setName] = useState(investigation.name);
  const [notes, setNotes] = useState(investigation.notes || '');
  const [duplicating, setDuplicating] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), notes });
  };

  const createdAt = new Date(investigation.createdAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  return (
    <form onSubmit={handleSubmit} className="p-3 space-y-3">
      <div>
        <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-ink-muted uppercase block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Add notes..."
          className="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm resize-none text-ink-muted placeholder-ink-faint"
        />
      </div>

      {traces && traces.length > 0 && (
        <div>
          <label className="text-xs font-semibold text-ink-muted uppercase block mb-1.5">Traces</label>
          <div className="space-y-1">
            {traces.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color || '#3b82f6' }} />
                <span className="text-xs text-ink-muted truncate">{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-ink-faint">Created {createdAt}</div>

      <div className="flex gap-2 pt-1">
        <button type="submit" className="px-3 py-1.5 bg-brand hover:bg-brand/90 rounded text-sm transition-colors">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-surface-raised hover:bg-surface-raised/80 rounded text-sm transition-colors">
          Cancel
        </button>
        {onDuplicate && (
          <button
            type="button"
            disabled={duplicating}
            onClick={async () => {
              setDuplicating(true);
              try {
                await onDuplicate();
              } finally {
                setDuplicating(false);
              }
            }}
            className="px-3 py-1.5 bg-surface-raised hover:bg-surface-raised/80 disabled:opacity-50 rounded text-sm transition-colors"
            title="Create a copy with the same traces"
          >
            {duplicating ? 'Duplicating…' : 'Duplicate'}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="px-3 py-1.5 text-red-400 hover:text-red-300 rounded text-sm ml-auto transition-colors"
        >
          Delete
        </button>
      </div>
    </form>
  );
}
