import { useState, useRef, useEffect } from 'react';
import { FaChevronDown } from 'react-icons/fa6';
import {
  NetworkEthereum,
  NetworkPolygon,
  NetworkArbitrumOne,
  NetworkBase,
  NetworkTron,
} from '@web3icons/react';
import { SUPPORTED_CHAINS } from '../services/types';
import type { IconComponent } from '@web3icons/react';

interface ChainSelectProps {
  value: string;               // chain id
  options: string[];           // chain ids to render (subset of SUPPORTED_CHAINS keys)
  onChange: (chain: string) => void;
  disabled?: boolean;
}

const CHAIN_ICON_MAP: Record<string, IconComponent> = {
  ethereum: NetworkEthereum,
  polygon: NetworkPolygon,
  arbitrum: NetworkArbitrumOne,
  base: NetworkBase,
  tron: NetworkTron,
};

function ChainIcon({ chainId }: { chainId: string }) {
  const Icon = CHAIN_ICON_MAP[chainId];
  if (Icon) {
    return <Icon variant="branded" size={16} />;
  }
  return <span className="w-4 h-4 rounded-full bg-gray-500 inline-block flex-shrink-0" />;
}

export function ChainSelect({ value, options, onChange, disabled }: ChainSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click (mirrors Header.tsx lines 33-40)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const selectedName = SUPPORTED_CHAINS[value]?.name ?? value;

  function handleTrigger() {
    if (disabled) return;
    setOpen((o) => !o);
  }

  function handleSelect(chainId: string) {
    onChange(chainId);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleTrigger}
        disabled={disabled}
        className={[
          'flex items-center gap-1.5 px-2 py-1.5 rounded text-sm transition-colors',
          disabled
            ? 'bg-gray-700 opacity-50 cursor-not-allowed'
            : 'bg-gray-700 hover:bg-gray-600 cursor-pointer',
        ].join(' ')}
      >
        <ChainIcon chainId={value} />
        <span>{selectedName}</span>
        <FaChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute left-0 mt-1 min-w-full bg-gray-700 border border-gray-600 rounded shadow-lg z-50 overflow-hidden">
          {options.map((chainId) => {
            const name = SUPPORTED_CHAINS[chainId]?.name ?? chainId;
            const isSelected = chainId === value;
            return (
              <button
                key={chainId}
                type="button"
                onClick={() => handleSelect(chainId)}
                className={[
                  'w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2',
                  isSelected ? 'bg-gray-600' : 'hover:bg-gray-600',
                ].join(' ')}
              >
                <ChainIcon chainId={chainId} />
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
