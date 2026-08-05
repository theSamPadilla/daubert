import { useState, useRef, useEffect } from 'react';
import { FaChevronDown } from 'react-icons/fa6';
import {
  NetworkEthereum,
  NetworkPolygon,
  NetworkArbitrumOne,
  NetworkBase,
  NetworkTron,
  NetworkBitcoin,
} from '@web3icons/react';
import { SUPPORTED_CHAINS } from '@/services/types';
import type { IconComponent } from '@web3icons/react';

interface ChainSelectProps {
  value: string;               // chain id
  options: string[];           // chain ids to render (subset of SUPPORTED_CHAINS keys)
  onChange: (chain: string) => void;
  disabled?: boolean;
  /** 'canvas' (default) matches the dark graph header; 'surface' matches light form pages. */
  tone?: 'canvas' | 'surface';
}

const CHAIN_ICON_MAP: Record<string, IconComponent> = {
  ethereum: NetworkEthereum,
  polygon: NetworkPolygon,
  arbitrum: NetworkArbitrumOne,
  base: NetworkBase,
  tron: NetworkTron,
  bitcoin: NetworkBitcoin,
};

function ChainIcon({ chainId }: { chainId: string }) {
  const Icon = CHAIN_ICON_MAP[chainId];
  if (Icon) {
    return <Icon variant="branded" size={16} />;
  }
  return <span className="w-4 h-4 rounded-full bg-canvas-fill inline-block flex-shrink-0" />;
}

export function ChainSelect({ value, options, onChange, disabled, tone = 'canvas' }: ChainSelectProps) {
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
          'flex items-center gap-1.5 rounded-lg text-sm transition-colors',
          tone === 'canvas'
            ? `px-2 py-1.5 text-canvas-ink ${
                disabled
                  ? 'bg-canvas-fill opacity-50 cursor-not-allowed'
                  : 'bg-canvas-fill hover:bg-canvas-fill cursor-pointer'
              }`
            : `w-full justify-between px-3 py-2 text-ink border border-line-strong bg-surface ${
                disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-raised cursor-pointer'
              }`,
        ].join(' ')}
      >
        <span className="flex items-center gap-1.5">
          <ChainIcon chainId={value} />
          <span>{selectedName}</span>
        </span>
        <FaChevronDown size={10} className={tone === 'surface' ? 'text-ink-faint' : undefined} />
      </button>

      {open && (
        <div
          className={[
            'absolute left-0 mt-1 min-w-full rounded-lg shadow-lg z-30 overflow-hidden border',
            tone === 'canvas'
              ? 'bg-canvas/95 backdrop-blur text-canvas-ink border-canvas-line'
              : 'bg-surface text-ink border-line',
          ].join(' ')}
        >
          {options.map((chainId) => {
            const name = SUPPORTED_CHAINS[chainId]?.name ?? chainId;
            const isSelected = chainId === value;
            const selectedBg =
              tone === 'canvas'
                ? isSelected
                  ? 'bg-canvas-fill'
                  : 'hover:bg-canvas-fill'
                : isSelected
                  ? 'bg-surface-raised'
                  : 'hover:bg-surface-raised';
            return (
              <button
                key={chainId}
                type="button"
                onClick={() => handleSelect(chainId)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${selectedBg}`}
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
