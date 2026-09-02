import { useState, useEffect, useRef } from 'react';
import { FaXmark } from 'react-icons/fa6';
import { TransactionEdge, WalletNode, Trace } from '@/types/investigation';
import { ColorPicker } from '@/components/Common/ColorPicker';
import { TagInput } from './TagInput';
import { CopyButton } from '@/components/Common/CopyButton';
import { SUPPORTED_CHAINS } from '@/services/types';
import { parseTimestamp } from '@/utils/formatAmount';

const inputClass =
  'w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink placeholder:text-canvas-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

function toDatetimeLocal(ts: string | undefined): string {
  if (!ts) return '';
  const d = parseTimestamp(ts);
  if (isNaN(d.getTime())) return '';
  // datetime-local format: YYYY-MM-DDTHH:MM
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

interface TransactionFormProps {
  transaction?: TransactionEdge;
  traces: Trace[];
  allWallets: { wallet: WalletNode; traceId: string }[];
  onSave: (traceId: string, data: Partial<TransactionEdge>) => void;
  onDelete?: (traceId: string) => void;
  onCancel: () => void;
  onCreateTrace?: () => Promise<string | undefined>;
  prefill?: Partial<TransactionEdge>;
}

function truncateAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Strip commas (thousands separators) and reject any non-numeric characters
// except a single decimal point. Keeps fields strictly parseable as Number().
function sanitizeNumeric(input: string): string {
  const cleaned = input.replace(/,/g, '').replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

function AddressField({
  label,
  value,
  onChange,
  allWallets,
  isKnownWallet,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allWallets: { wallet: WalletNode; traceId: string }[];
  isKnownWallet: (v: string) => boolean;
}) {
  const [manualEntry, setManualEntry] = useState(!isKnownWallet(value) && value !== '');

  // Display label for a resolved wallet
  const walletLabel = (id: string) => {
    const w = allWallets.find((e) => e.wallet.id === id);
    return w ? `${w.wallet.label} (${truncateAddr(w.wallet.address)})` : '';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-canvas-muted uppercase">{label}</span>
        {allWallets.length > 0 && (
          <button
            type="button"
            onClick={() => { setManualEntry(!manualEntry); if (!manualEntry) onChange(''); }}
            className="text-[10px] text-brand hover:text-brand-strong transition-colors"
          >
            {manualEntry ? 'Select existing' : 'New address'}
          </button>
        )}
      </div>
      {manualEntry ? (
        <>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-xs text-canvas-ink placeholder:text-canvas-muted font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            placeholder="Paste address"
            required
          />
          {value && !isKnownWallet(value) && (
            <p className="text-[10px] text-canvas-muted/60 mt-0.5">
              New node: <span className="font-mono">{truncateAddr(value)}</span>
            </p>
          )}
        </>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-xs text-canvas-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          required
        >
          <option value="">Select address</option>
          {allWallets.map(({ wallet }) => (
            <option key={wallet.id} value={wallet.id}>
              {wallet.label} ({truncateAddr(wallet.address)})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function TransactionForm({
  transaction,
  traces,
  allWallets,
  onSave,
  onDelete,
  onCancel,
  onCreateTrace,
  prefill,
}: TransactionFormProps) {
  const source = transaction || prefill;

  // Resolve prefilled raw addresses to existing wallet IDs
  const resolveToWalletId = (val: string) => {
    if (!val) return val;
    // Already a wallet ID?
    if (allWallets.some((w) => w.wallet.id === val)) return val;
    // Match by address
    const match = allWallets.find((w) => w.wallet.address.toLowerCase() === val.toLowerCase());
    return match ? match.wallet.id : val;
  };

  const [from, setFrom] = useState(resolveToWalletId(source?.from || ''));
  const [to, setTo] = useState(resolveToWalletId(source?.to || ''));
  const [txHash, setTxHash] = useState(source?.txHash || '');
  const [chain, setChain] = useState(source?.chain || 'ethereum');
  const [amount, setAmount] = useState(source?.amount || '');
  const [tokenSymbol, setTokenSymbol] = useState(source?.token?.symbol || (chain === 'tron' ? 'TRX' : 'ETH'));
  const [tokenAddress, setTokenAddress] = useState(source?.token?.address || '0x');
  const [tokenDecimals, setTokenDecimals] = useState(String(source?.token?.decimals ?? 0));
  const [usdValue, setUsdValue] = useState(source?.usdValue != null ? String(source.usdValue) : '');
  const [label, setLabel] = useState(source?.label || '');
  const [timestamp, setTimestamp] = useState(() => toDatetimeLocal(source?.timestamp));
  const [blockNumber, setBlockNumber] = useState(String(source?.blockNumber || ''));
  const [color, setColor] = useState(source?.color || '#10b981');
  const [notes, setNotes] = useState(source?.notes || '');
  const [tags, setTags] = useState<string[]>(source?.tags || []);
  const [links, setLinks] = useState<string[]>(source?.links || []);
  const [linkInput, setLinkInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [traceId, setTraceId] = useState(traces[0]?.id || '');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the name input on mount so keyboard flow continues after the panel opens
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Determine trace for this transaction (from wallet's trace)
  const findTraceForWallet = (walletId: string) => {
    const entry = allWallets.find((w) => w.wallet.id === walletId);
    return entry?.traceId;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const fromTrace = findTraceForWallet(from);
    const toTrace = findTraceForWallet(to);
    const crossTrace = !!(fromTrace && toTrace && fromTrace !== toTrace);

    /**
     * An edge has to land in a trace — `mapTrace` in the reducer drops any write
     * whose trace id does not resolve. Normally an investigation always has one
     * (the backend creates it), so this only fires when the user has deleted every
     * trace. Creating one here is what keeps the input from being lost.
     */
    let resolvedTraceId = fromTrace || traceId || traces[0]?.id || '';
    if (!resolvedTraceId) {
      if (!onCreateTrace) {
        setSaveError('This transaction needs a trace, and none could be created.');
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

    onSave(resolvedTraceId, {
      from,
      to,
      txHash,
      chain,
      amount,
      token: {
        symbol: tokenSymbol,
        address: tokenAddress,
        decimals: Number(tokenDecimals) || 0,
      },
      usdValue: usdValue ? Number(usdValue) : undefined,
      label,
      color,
      timestamp: (() => { const d = timestamp ? new Date(timestamp) : null; return d && !isNaN(d.getTime()) ? d.toISOString() : ''; })(),
      blockNumber: Number(blockNumber) || 0,
      notes,
      tags,
      links,
      crossTrace,
      // Carried straight off the prefill: these describe the transaction as
      // decoded from its receipt, not anything the form edits. Dropping them
      // here is what previously made the transfer picker unreachable.
      transfers: source?.transfers,
      selectedTransferIndex: source?.selectedTransferIndex,
      tokenStandard: source?.tokenStandard,
      tokenId: source?.tokenId,
    });
  };

  // Find current trace for delete
  const currentTraceId = transaction
    ? (findTraceForWallet(transaction.from) || traces[0]?.id || '')
    : '';

  // Check if value is an existing wallet (by ID or address)
  const isKnownWallet = (val: string) =>
    allWallets.some((w) => w.wallet.id === val || w.wallet.address.toLowerCase() === val.toLowerCase());

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Trace selector for new transactions */}
      {!transaction && (
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
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">
          Name <span className="text-canvas-muted/60 normal-case font-normal">(optional)</span>
        </label>
        <input
          ref={nameRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Donation, NFT purchase…"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <AddressField
          label="From"
          value={from}
          onChange={setFrom}
          allWallets={allWallets}
          isKnownWallet={isKnownWallet}
        />
        <AddressField
          label="To"
          value={to}
          onChange={setTo}
          allWallets={allWallets}
          isKnownWallet={isKnownWallet}
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">
          Tx Hash <span className="text-canvas-muted/60 normal-case font-normal">(optional)</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            className="flex-1 min-w-0 bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-sm text-canvas-ink placeholder:text-canvas-muted font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            placeholder="0x..."
          />
          {txHash && (
            <CopyButton
              text={txHash}
              title="Copy tx hash"
              className="shrink-0 text-canvas-muted hover:text-canvas-ink transition-colors"
              size={13}
            />
          )}
        </div>
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

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Amount</label>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(sanitizeNumeric(e.target.value))}
            className={inputClass}
            required
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Symbol</label>
          <input
            type="text"
            value={tokenSymbol}
            onChange={(e) => setTokenSymbol(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">USD</label>
          <input
            type="text"
            inputMode="decimal"
            value={usdValue}
            onChange={(e) => setUsdValue(sanitizeNumeric(e.target.value))}
            className={inputClass}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Token Address</label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-xs text-canvas-ink placeholder:text-canvas-muted font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Decimals</label>
          <input
            type="number"
            value={tokenDecimals}
            onChange={(e) => setTokenDecimals(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Timestamp</label>
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
            className="w-full bg-canvas-fill border border-canvas-line rounded-lg px-3 py-2 text-xs text-canvas-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Block #</label>
          <input
            type="number"
            value={blockNumber}
            onChange={(e) => setBlockNumber(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Color</label>
        <ColorPicker value={color} onChange={setColor} />
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Tags</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Links</label>
        <div className="space-y-1">
          {links.map((link, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="url"
                value={link}
                onChange={(e) => setLinks(links.map((l, j) => j === i ? e.target.value : l))}
                className="flex-1 bg-canvas-fill border border-canvas-line rounded-lg px-3 py-1.5 text-xs text-canvas-ink placeholder:text-canvas-muted font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 min-w-0"
              />
              <button
                type="button"
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
                className="text-canvas-muted hover:text-redline shrink-0 transition-colors"
                aria-label="Remove link"
              >
                <FaXmark className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <input
              type="url"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = linkInput.trim();
                  if (v) { setLinks([...links, v]); setLinkInput(''); }
                }
              }}
              placeholder="https://… (Enter to add)"
              className="flex-1 bg-canvas-fill border border-canvas-line rounded-lg px-3 py-1.5 text-xs text-canvas-ink placeholder:text-canvas-muted font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 min-w-0"
            />
            <button
              type="button"
              onClick={() => {
                const v = linkInput.trim();
                if (v) { setLinks([...links, v]); setLinkInput(''); }
              }}
              className="text-canvas-muted hover:text-canvas-ink text-lg leading-none shrink-0 transition-colors"
            >+</button>
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-canvas-muted uppercase block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
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
        {onDelete && transaction && (
          <>
            {showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => onDelete(currentTraceId)}
                className="px-3 py-1.5 bg-redline text-white hover:bg-redline/90 rounded-lg text-sm ml-auto transition-colors"
              >
                Confirm
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
