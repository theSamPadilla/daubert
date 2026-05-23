import { useState } from 'react';
import { SUPPORTED_CHAINS } from '../services/types';

interface FetchHistoryPanelProps {
  initialAddress?: string;
  initialChain?: string;
  onFetch: (address: string, chain: string) => void;
  loading: boolean;
}

export function FetchHistoryPanel({ initialAddress, initialChain, onFetch, loading }: FetchHistoryPanelProps) {
  const [address, setAddress] = useState(initialAddress || '');
  const [chain, setChain] = useState(initialChain || 'ethereum');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (address.trim()) {
      onFetch(address.trim(), chain);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <h4 className="text-xs font-semibold text-ink-muted uppercase">Fetch History</h4>
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Wallet address (0x...)"
        className="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm font-mono"
        required
      />
      <div className="flex gap-2">
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="flex-1 bg-surface border border-line-strong rounded px-2 py-1.5 text-sm"
        >
          {Object.values(SUPPORTED_CHAINS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="px-3 py-1.5 bg-brand hover:bg-brand/90 disabled:bg-surface-raised disabled:text-ink-faint rounded text-sm"
        >
          {loading ? 'Fetching...' : 'Fetch'}
        </button>
      </div>
    </form>
  );
}
