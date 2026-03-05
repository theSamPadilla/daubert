import { useState, useEffect } from 'react';
import { WalletNode, Trace } from '../types/investigation';
import { ColorPicker } from './ColorPicker';
import { TagInput } from './TagInput';
import { SUPPORTED_CHAINS } from '../services/types';
import { parseAddressInput } from '../utils/addressParser';

interface WalletFormProps {
  wallet?: WalletNode;
  traces: Trace[];
  selectedTraceId?: string;
  onSave: (traceId: string, data: Partial<WalletNode>) => void;
  onDelete?: (traceId: string) => void;
  onCancel: () => void;
  onCreateTrace?: () => Promise<string | undefined>;
  prefill?: Partial<WalletNode>;
}

export function WalletForm({ wallet, traces, selectedTraceId, onSave, onDelete, onCancel, onCreateTrace, prefill }: WalletFormProps) {
  const source = wallet || prefill;
  const [label, setLabel] = useState(source?.label || '');
  const [address, setAddress] = useState(source?.address || '');
  const [chain, setChain] = useState(source?.chain || 'ethereum');
  const [color, setColor] = useState(wallet?.color || '#60a5fa');
  const [size, setSize] = useState(wallet?.size || 60);
  const [notes, setNotes] = useState(wallet?.notes || '');
  const [tags, setTags] = useState<string[]>(wallet?.tags || []);
  const [traceId, setTraceId] = useState(wallet?.parentTrace || selectedTraceId || traces[0]?.id || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [labelTouched, setLabelTouched] = useState(!!wallet?.label && !prefill);
  const [creatingTrace, setCreatingTrace] = useState(false);

  // Sync traceId when traces list changes (e.g. after inline create)
  useEffect(() => {
    if (!traceId && traces.length > 0) {
      setTraceId(traces[traces.length - 1].id);
    }
  }, [traces, traceId]);

  const handleAddressChange = (raw: string) => {
    setAddress(raw);
    const parsed = parseAddressInput(raw);
    if (parsed.address !== raw) {
      setAddress(parsed.address);
    }
    if (parsed.chain) {
      setChain(parsed.chain);
    }
    if (!labelTouched && parsed.address) {
      const addr = parsed.address;
      if (addr.length > 10) {
        setLabel(`${addr.slice(0, 6)}...${addr.slice(-4)}`);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(traceId, { label, address, chain, color, size, notes, tags });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!wallet && (
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Trace</label>
          {traces.length === 0 ? (
            <button
              type="button"
              disabled={creatingTrace}
              onClick={async () => {
                if (!onCreateTrace) return;
                setCreatingTrace(true);
                const newId = await onCreateTrace();
                setCreatingTrace(false);
                if (newId) setTraceId(newId);
              }}
              className="w-full px-2 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm text-center"
            >
              {creatingTrace ? 'Creating...' : '+ Create Trace'}
            </button>
          ) : (
            <div className="flex gap-1.5">
              <select
                value={traceId}
                onChange={(e) => setTraceId(e.target.value)}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
              >
                {traces.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {onCreateTrace && (
                <button
                  type="button"
                  disabled={creatingTrace}
                  onClick={async () => {
                    setCreatingTrace(true);
                    const newId = await onCreateTrace();
                    setCreatingTrace(false);
                    if (newId) setTraceId(newId);
                  }}
                  className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-sm shrink-0"
                  title="New trace"
                >
                  +
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          required
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Address <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
        <input
          type="text"
          value={address}
          onChange={(e) => handleAddressChange(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
          placeholder="0x... or block explorer URL"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Chain</label>
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
        >
          {Object.values(SUPPORTED_CHAINS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Size</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={30}
            max={120}
            step={5}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <span className="text-xs text-gray-400 w-8 text-right">{size}</span>
        </div>
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
