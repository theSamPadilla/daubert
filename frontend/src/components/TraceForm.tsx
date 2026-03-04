import { useState } from 'react';
import { Trace } from '../types/investigation';
import { ColorPicker } from './ColorPicker';

interface TraceFormProps {
  trace?: Trace;
  onSave: (data: Partial<Trace>) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

export function TraceForm({ trace, onSave, onDelete, onCancel }: TraceFormProps) {
  const [name, setName] = useState(trace?.name || '');
  const [type, setType] = useState<'time' | 'wallet-group' | 'custom'>(trace?.criteria.type || 'custom');
  const [color, setColor] = useState(trace?.color || '#3b82f6');
  const [startTime, setStartTime] = useState(trace?.criteria.timeRange?.start?.slice(0, 16) || '');
  const [endTime, setEndTime] = useState(trace?.criteria.timeRange?.end?.slice(0, 16) || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<Trace> = {
      name,
      color,
      criteria: {
        type,
        ...(type === 'time' && startTime && endTime
          ? { timeRange: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() } }
          : {}),
      },
    };
    onSave(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          required
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
        >
          <option value="custom">Custom</option>
          <option value="time">Time Range</option>
          <option value="wallet-group">Wallet Group</option>
        </select>
      </div>

      {type === 'time' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Start</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">End</label>
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div className="flex gap-2 pt-2">
        <button type="submit" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm">
          Cancel
        </button>
        {onDelete && (
          <>
            {showDeleteConfirm ? (
              <button
                type="button"
                onClick={onDelete}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm ml-auto"
              >
                Confirm Delete
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 text-red-400 hover:text-red-300 rounded text-sm ml-auto"
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
