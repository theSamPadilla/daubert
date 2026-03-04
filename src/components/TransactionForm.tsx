import { useState } from 'react';
import { TransactionEdge, WalletNode, Trace } from '../types/investigation';
import { ColorPicker } from './ColorPicker';
import { TagInput } from './TagInput';
import { CHAIN_CONFIGS } from '../services/types';

interface TransactionFormProps {
  transaction?: TransactionEdge;
  traces: Trace[];
  allWallets: { wallet: WalletNode; traceId: string }[];
  onSave: (traceId: string, data: Partial<TransactionEdge>) => void;
  onDelete?: (traceId: string) => void;
  onCancel: () => void;
}

function truncateAddr(addr: string) {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function TransactionForm({
  transaction,
  traces,
  allWallets,
  onSave,
  onDelete,
  onCancel,
}: TransactionFormProps) {
  const [from, setFrom] = useState(transaction?.from || '');
  const [to, setTo] = useState(transaction?.to || '');
  const [txHash, setTxHash] = useState(transaction?.txHash || '');
  const [chain, setChain] = useState(transaction?.chain || 'ethereum');
  const [amount, setAmount] = useState(transaction?.amount || '');
  const [tokenSymbol, setTokenSymbol] = useState(transaction?.token.symbol || 'ETH');
  const [tokenAddress, setTokenAddress] = useState(transaction?.token.address || '0x');
  const [tokenDecimals, setTokenDecimals] = useState(String(transaction?.token.decimals ?? 18));
  const [usdValue, setUsdValue] = useState(transaction?.usdValue != null ? String(transaction.usdValue) : '');
  const [label, setLabel] = useState(transaction?.label || '');
  const [timestamp, setTimestamp] = useState(
    transaction?.timestamp ? transaction.timestamp.slice(0, 16) : ''
  );
  const [blockNumber, setBlockNumber] = useState(String(transaction?.blockNumber || ''));
  const [color, setColor] = useState(transaction?.color || '#10b981');
  const [notes, setNotes] = useState(transaction?.notes || '');
  const [tags, setTags] = useState<string[]>(transaction?.tags || []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
    const traceId = fromTrace || traces[0]?.id || '';

    onSave(traceId, {
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

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">From</label>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs"
            required
          >
            <option value="">Select wallet</option>
            {allWallets.map(({ wallet }) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.label} ({truncateAddr(wallet.address)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-400 uppercase block mb-1">To</label>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs"
            required
          >
            <option value="">Select wallet</option>
            {allWallets.map(({ wallet }) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.label} ({truncateAddr(wallet.address)})
              </option>
            ))}
          </select>
        </div>
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
            {Object.values(CHAIN_CONFIGS).map((c) => (
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
