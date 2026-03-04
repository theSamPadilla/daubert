import { useState } from 'react';
import { CHAIN_CONFIGS } from '../services/types';

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
      <h4 className="text-xs font-semibold text-gray-400 uppercase">Fetch History</h4>
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Wallet address (0x...)"
        className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono"
        required
      />
      <div className="flex gap-2">
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
        >
          {Object.values(CHAIN_CONFIGS).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm"
        >
          {loading ? 'Fetching...' : 'Fetch'}
        </button>
      </div>
    </form>
  );
}
