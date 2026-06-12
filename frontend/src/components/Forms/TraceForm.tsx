import { useState } from 'react';
import { Trace } from '@/types/investigation';
import { ColorPicker } from '@/components/Common/ColorPicker';

const inputClass =
  'w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

interface TraceFormProps {
  trace?: Trace;
  onSave: (data: Partial<Trace>) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

export function TraceForm({ trace, onSave, onDelete, onCancel }: TraceFormProps) {
  const [name, setName] = useState(trace?.name || '');
  const [type, setType] = useState<'time' | 'wallet-group' | 'custom'>(trace?.criteria.type || 'custom');
  const [color, setColor] = useState(trace?.color || '');
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(trace?.criteria.timeRange?.start?.slice(0, 10) || '');
  const [endDate, setEndDate] = useState(trace?.criteria.timeRange?.end?.slice(0, 10) || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<Trace> = {
      name,
      color: color || undefined,
      criteria: {
        type,
        ...(type === 'time' && startDate && endDate
          ? { timeRange: { start: new Date(`${startDate}T00:00:00Z`).toISOString(), end: new Date(`${endDate}T00:00:00Z`).toISOString() } }
          : {}),
      },
    };
    onSave(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className={inputClass}
        >
          <option value="custom">Custom</option>
          <option value="time">Time Range</option>
          <option value="wallet-group">Wallet Group</option>
        </select>
      </div>

      {type === 'time' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-canvas-muted block mb-1">Start</label>
            <input
              type="date"
              value={startDate}
              max={today}
              onChange={(e) => { setStartDate(e.target.value); if (endDate && e.target.value > endDate) setEndDate(''); }}
              className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-xs text-canvas-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
          </div>
          <div>
            <label className="text-xs text-canvas-muted block mb-1">End</label>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              max={today}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-xs text-canvas-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Color</label>
        <ColorPicker value={color} onChange={setColor} allowNone />
      </div>

      <div className="flex gap-2 pt-2">
        <button type="submit" className="px-3 py-1.5 bg-brand text-white hover:bg-brand-strong rounded-lg text-sm transition-colors">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-canvas-line text-canvas-muted hover:text-canvas-ink hover:bg-canvas-fill rounded-lg text-sm transition-colors">
          Cancel
        </button>
        {onDelete && (
          <>
            {showDeleteConfirm ? (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-1.5 bg-redline text-white hover:bg-redline/90 rounded-lg text-sm ml-auto transition-colors"
              >
                Confirm Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 text-redline hover:text-redline/80 rounded-lg text-sm ml-auto transition-colors"
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </form>
  );
}
