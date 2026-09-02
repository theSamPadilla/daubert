import { useState, useEffect, useRef } from 'react';
import { WalletNode, Trace } from '@/types/investigation';
import { TagInput } from './TagInput';
import { SUPPORTED_CHAINS } from '@/services/types';
import { parseAddressInput } from '@/utils/addressParser';

const inputClass =
  'w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

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
  const [size, setSize] = useState(wallet?.size || 60);
  const [notes, setNotes] = useState(wallet?.notes || '');
  const [tags, setTags] = useState<string[]>(wallet?.tags || []);
  const [traceId, setTraceId] = useState(wallet?.parentTrace || selectedTraceId || traces[0]?.id || '');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [labelTouched, setLabelTouched] = useState(!!wallet?.label && !prefill);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  // Focus the label input on mount so keyboard flow continues after the panel opens
  useEffect(() => {
    labelRef.current?.focus();
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    /**
     * A wallet has to land in a trace — `mapTrace` in the reducer drops any write
     * whose trace id does not resolve. Normally an investigation always has one
     * (the backend creates it), so this only fires when the user has deleted every
     * trace. Creating one here is what keeps the input from being lost.
     */
    let resolvedTraceId = traceId || traces[0]?.id || '';
    if (!resolvedTraceId) {
      if (!onCreateTrace) {
        setSaveError('This address needs a trace, and none could be created.');
        return;
      }
      setSaving(true);
      let newId: string | undefined;
      try {
        newId = await onCreateTrace();
      } catch {
        newId = undefined;
      } finally {
        setSaving(false);
      }
      if (!newId) {
        setSaveError('Could not create a trace. Check your connection and try again.');
        return;
      }
      resolvedTraceId = newId;
    }
    setSaveError(null);

    onSave(resolvedTraceId, { label, address, chain, size, notes, tags });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {!wallet && (
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Trace</label>
          {traces.length === 0 ? (
            <p className="text-xs text-canvas-muted/60">
              No traces yet. One will be created when you save.
            </p>
          ) : (
            <div className="flex gap-1.5">
              <select
                value={traceId}
                onChange={(e) => setTraceId(e.target.value)}
                className="flex-1 bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {traces.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {onCreateTrace && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const newId = await onCreateTrace();
                      if (newId) setTraceId(newId);
                    } catch {
                      // Leave the trace selection unchanged on failure; the button
                      // re-enables (finally, below) so the user can retry.
                    } finally {
                      setSaving(false);
                    }
                  }}
                  className="px-3 py-2 border border-canvas-line text-canvas-muted hover:text-canvas-ink hover:bg-canvas-fill disabled:opacity-50 rounded-lg text-sm shrink-0 transition-colors"
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
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Label</label>
        <input
          ref={labelRef}
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">
          Address <span className="text-canvas-muted/60 normal-case font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={address}
          onChange={(e) => handleAddressChange(e.target.value)}
          className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink placeholder:text-canvas-muted font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          placeholder="0x... or block explorer URL"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Chain</label>
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {Object.values(SUPPORTED_CHAINS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Size</label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={30}
            max={120}
            step={5}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="flex-1 accent-brand"
          />
          <span className="text-xs text-canvas-muted w-8 text-right">{size}</span>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Tags</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-none"
        />
      </div>

      {saveError && <p className="text-redline text-xs">{saveError}</p>}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 bg-brand text-white hover:bg-brand-strong disabled:opacity-50 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-canvas-line text-canvas-muted hover:text-canvas-ink hover:bg-canvas-fill rounded-lg text-sm transition-colors">
          Cancel
        </button>
        {onDelete && wallet && (
          <>
            {showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => onDelete(wallet.parentTrace)}
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
