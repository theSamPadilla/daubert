import { useState } from 'react';
import { type Investigation, type Trace } from '@/lib/api-client';

interface InvestigationFormProps {
  investigation: Investigation;
  traces?: Trace[];
  onSave: (updates: { name: string; notes: string }) => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function InvestigationForm({ investigation, traces, onSave, onDelete, onCancel }: InvestigationFormProps) {
  const [name, setName] = useState(investigation.name);
  const [notes, setNotes] = useState(investigation.notes || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          required
          autoFocus
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Add notes..."
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm resize-none text-gray-300 placeholder-gray-600"
        />
      </div>

      {traces && traces.length > 0 && (
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1.5">Traces</label>
          <div className="space-y-1">
            {traces.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color || '#3b82f6' }} />
                <span className="text-xs text-gray-400 truncate">{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-600">Created {createdAt}</div>

      <div className="flex gap-2 pt-1">
        <button type="submit" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
          Cancel
        </button>
        {showDeleteConfirm ? (
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm ml-auto transition-colors"
          >
            Confirm Delete
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="px-3 py-1.5 text-red-400 hover:text-red-300 rounded text-sm ml-auto transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
