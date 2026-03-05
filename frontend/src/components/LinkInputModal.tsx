import { useState, useRef, useEffect } from 'react';
import { detectInputType, parseAddressInput, parseTxInput } from '../utils/addressParser';
import { apiClient } from '../lib/api-client';
import { SUPPORTED_CHAINS } from '../services/types';
import { WalletNode, TransactionEdge } from '../types/investigation';

export interface LinkInputResult {
  type: 'address' | 'transaction';
  addressPrefill?: Partial<WalletNode>;
  txPrefill?: Partial<TransactionEdge>;
}

interface LinkInputModalProps {
  intent: 'address' | 'transaction';
  onResolved: (result: LinkInputResult) => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function LinkInputModal({ intent, onResolved, onSkip, onCancel }: LinkInputModalProps) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chainOverride, setChainOverride] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Detect if we need a chain picker (raw EVM input with no chain info)
  const detected = value.trim() ? detectInputType(value.trim()) : 'unknown';
  const parsed = value.trim()
    ? detected === 'transaction'
      ? parseTxInput(value.trim())
      : parseAddressInput(value.trim())
    : null;
  const needsChainPicker = parsed && !('chain' in parsed && parsed.chain);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const type = detectInputType(trimmed);
    setError('');

    if (type === 'transaction' || (type === 'unknown' && intent === 'transaction')) {
      const txParsed = parseTxInput(trimmed);
      const chain = txParsed.chain || chainOverride || 'ethereum';

      setLoading(true);
      try {
        const detail = await apiClient.getTransaction(txParsed.txHash, chain);

        // Use the primary token transfer if there are any, otherwise native
        const primaryTransfer = detail.tokenTransfers[0];
        const token = primaryTransfer?.token || detail.token;
        const amount = primaryTransfer?.amount || detail.amount;
        const from = primaryTransfer?.from || detail.from;
        const to = primaryTransfer?.to || detail.to;

        onResolved({
          type: 'transaction',
          txPrefill: {
            txHash: detail.txHash,
            from,
            to,
            chain: detail.chain,
            amount,
            token,
            timestamp: detail.timestamp,
            blockNumber: detail.blockNumber,
          },
        });
      } catch (err: any) {
        setError(err.message || 'Failed to fetch transaction');
        setLoading(false);
      }
    } else {
      // Address — no API call needed, just parse
      const addrParsed = parseAddressInput(trimmed);
      const chain = addrParsed.chain || chainOverride || 'ethereum';
      const addr = addrParsed.address;

      onResolved({
        type: 'address',
        addressPrefill: {
          address: addr,
          chain,
          label: addr.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr,
          explorerUrl: addrParsed.explorerUrl,
        },
      });
    }
  };

  const label = intent === 'transaction' ? 'Transaction' : 'Address';
  const placeholder = intent === 'transaction'
    ? 'Paste tx URL or hash (e.g. etherscan.io/tx/0x...)'
    : 'Paste address or explorer URL (e.g. etherscan.io/address/0x...)';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
      <div className="bg-gray-800 rounded-lg p-6 w-[440px]">
        <h3 className="text-sm font-semibold text-gray-300 uppercase mb-4">
          New {label}
        </h3>
        <p className="text-xs text-gray-400 mb-3">
          Paste a block explorer link or raw {intent === 'transaction' ? 'tx hash' : 'address'} to auto-fill details.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim() && !loading) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
          placeholder={placeholder}
          disabled={loading}
        />

        {needsChainPicker && (
          <div className="mt-2">
            <label className="text-xs text-gray-400 block mb-1">Chain</label>
            <select
              value={chainOverride || 'ethereum'}
              onChange={(e) => setChainOverride(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
            >
              {Object.values(SUPPORTED_CHAINS).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 mt-2">{error}</p>
        )}

        {loading && (
          <p className="text-xs text-blue-400 mt-2">Fetching transaction details...</p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || loading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 rounded text-sm"
          >
            {loading ? 'Loading...' : 'Continue'}
          </button>
          <button
            onClick={onSkip}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            Enter manually
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 text-gray-400 hover:text-white rounded text-sm ml-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
