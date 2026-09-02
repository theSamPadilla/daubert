import {
  NetworkEthereum,
  NetworkPolygon,
  NetworkArbitrumOne,
  NetworkBase,
  NetworkTron,
  NetworkBitcoin,
  NetworkSolana,
} from '@web3icons/react';
import type { IconComponent } from '@web3icons/react';
import { CHAINS } from '@/generated/shared/chains';

const CHAIN_ICON_MAP: Record<string, IconComponent> = {
  ethereum: NetworkEthereum,
  polygon: NetworkPolygon,
  arbitrum: NetworkArbitrumOne,
  base: NetworkBase,
  tron: NetworkTron,
  bitcoin: NetworkBitcoin,
  solana: NetworkSolana,
};

/**
 * Branded network mark for a chain id, with a neutral placeholder for any chain
 * the icon set does not cover. Extracted from `ChainSelect` so the details
 * panels can identify a chain the same way the picker does.
 */
export function ChainIcon({ chainId, size = 16 }: { chainId: string; size?: number }) {
  const Icon = CHAIN_ICON_MAP[chainId];
  if (Icon) return <Icon variant="branded" size={size} />;
  return (
    <span
      className="rounded-full bg-canvas-fill inline-block flex-shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

/** Display name for a chain id, falling back to the raw id for unknown chains. */
export function chainDisplayName(chainId: string): string {
  return CHAINS[chainId]?.name ?? chainId;
}

/** Icon plus display name, the standard way to show a chain in a details panel. */
export function ChainLabel({ chainId, size = 16 }: { chainId: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-canvas-ink">
      <ChainIcon chainId={chainId} size={size} />
      {chainDisplayName(chainId)}
    </span>
  );
}
