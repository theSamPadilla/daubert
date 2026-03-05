import { useState, useEffect } from 'react';
import { TransactionEdge, WalletNode, Trace } from '../types/investigation';
import { ColorPicker } from './ColorPicker';
import { TagInput } from './TagInput';
import { SUPPORTED_CHAINS } from '../services/types';

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
        <span className="text-xs font-semibold text-gray-400 uppercase">{label}</span>
        {allWallets.length > 0 && (
          <button
            type="button"
            onClick={() => { setManualEntry(!manualEntry); if (!manualEntry) onChange(''); }}
            className="text-[10px] text-blue-400 hover:text-blue-300"
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
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono"
            placeholder="Paste address"
            required
          />
          {value && !isKnownWallet(value) && (
            <p className="text-[10px] text-gray-500 mt-0.5">
              New node: <span className="font-mono">{truncateAddr(value)}</span>
            </p>
          )}
        </>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs"
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
  const [tokenDecimals, setTokenDecimals] = useState(String(source?.token?.decimals ?? 18));
  const [usdValue, setUsdValue] = useState(source?.usdValue != null ? String(source.usdValue) : '');
  const [label, setLabel] = useState(source?.label || '');
  const [timestamp, setTimestamp] = useState(
    source?.timestamp ? source.timestamp.slice(0, 16) : ''
  );
  const [blockNumber, setBlockNumber] = useState(String(source?.blockNumber || ''));
  const [color, setColor] = useState(source?.color || '#10b981');
  const [notes, setNotes] = useState(source?.notes || '');
  const [tags, setTags] = useState<string[]>(source?.tags || []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [traceId, setTraceId] = useState(traces[0]?.id || '');
  const [creatingTrace, setCreatingTrace] = useState(false);

  // Sync traceId when traces list changes (e.g. after inline create)
  useEffect(() => {
    if (!traceId && traces.length > 0) {
      setTraceId(traces[traces.length - 1].id);
    }
  }, [traces, traceId]);

  // Determine trace for this transaction (from wallet's trace)
  const findTraceForWallet = (walletId: string) => {
    const entry = allWallets.find((w) => w.wallet.id === walletId);
    return entry?.traceId;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const fromTrace = findTraceForWallet(from);
    const toTrace = findTraceForWallet(to);
    const crossTrace = !!(fromTrace && toTrace && fromTrace !== toTrace);
    const resolvedTraceId = fromTrace || traceId || traces[0]?.id || '';

    onSave(resolvedTraceId, {
      from,
      to,
      txHash,
      chain,
      amount,
      token: {
        symbol: tokenSymbol,
        address: tokenAddress,
        decimals: Number(tokenDecimals) || 18,
      },
      usdValue: usdValue ? Number(usdValue) : undefined,
      label,
      color,
      timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
      blockNumber: Number(blockNumber) || 0,
      notes,
      tags,
      crossTrace,
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
        <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Tx Hash</label>
        <input
          type="text"
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
          placeholder="0x..."
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
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
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Amount</label>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
            required
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Symbol</label>
          <input
            type="text"
            value={tokenSymbol}
            onChange={(e) => setTokenSymbol(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">USD</label>
          <input
            type="text"
            value={usdValue}
            onChange={(e) => setUsdValue(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Token Address</label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs font-mono"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Decimals</label>
          <input
            type="number"
            value={tokenDecimals}
            onChange={(e) => setTokenDecimals(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Timestamp</label>
          <input
            type="datetime-local"
            value={timestamp}
            onChange={(e) => setTimestamp(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">Block #</label>
          <input
            type="number"
            value={blockNumber}
            onChange={(e) => setBlockNumber(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
          />
        </div>
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
          rows={2}
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
        {onDelete && transaction && (
          <>
            {showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => onDelete(currentTraceId)}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm ml-auto"
              >
                Confirm
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
