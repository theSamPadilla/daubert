import { useState } from 'react';
import { WalletNode, Trace } from '../types/investigation';
import { ColorPicker } from './ColorPicker';
import { TagInput } from './TagInput';
import { CHAIN_CONFIGS } from '../services/types';

interface WalletFormProps {
  wallet?: WalletNode;
  traces: Trace[];
  selectedTraceId?: string;
  onSave: (traceId: string, data: Partial<WalletNode>) => void;
  onDelete?: (traceId: string) => void;
  onCancel: () => void;
}

export function WalletForm({ wallet, traces, selectedTraceId, onSave, onDelete, onCancel }: WalletFormProps) {
  const [label, setLabel] = useState(wallet?.label || '');
  const [address, setAddress] = useState(wallet?.address || '');
  const [chain, setChain] = useState(wallet?.chain || 'ethereum');
  const [color, setColor] = useState(wallet?.color || '#60a5fa');
  const [notes, setNotes] = useState(wallet?.notes || '');
  const [tags, setTags] = useState<string[]>(wallet?.tags || []);
  const [traceId, setTraceId] = useState(wallet?.parentTrace || selectedTraceId || traces[0]?.id || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(traceId, { label, address, chain, color, notes, tags });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!wallet && (
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Trace</label>
          <select
            value={traceId}
            onChange={(e) => setTraceId(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          >
            {traces.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          required
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Address</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
          placeholder="0x..."
          required
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Chain</label>
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
        >
          {Object.values(CHAIN_CONFIGS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Tags</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm resize-none"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button type="submit" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm">
          Cancel
        </button>
        {onDelete && wallet && (
          <>
            {showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => onDelete(wallet.parentTrace)}
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
