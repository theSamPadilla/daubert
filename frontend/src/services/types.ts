import { CHAINS } from '../generated/shared/chains';

export interface ChainConfig {
  id: string;
  name: string;
  chainId: number;
  nativeCurrency: { symbol: string; decimals: number };
  explorerUrl: string;
}

// Derived from the shared chain registry so backend and frontend never drift.
export const SUPPORTED_CHAINS: Record<string, ChainConfig> = Object.fromEntries(
  Object.entries(CHAINS).map(([id, def]) => [
    id,
    {
      id: def.id,
      name: def.name,
      chainId: def.chainId,
      nativeCurrency: def.nativeCurrency,
      explorerUrl: def.explorerUrl,
    },
  ]),
);
