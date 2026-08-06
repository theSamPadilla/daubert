/**
 * CHAIN_CONFIGS is now derived from the shared chain registry
 * (generated/shared/chains.ts) rather than hand-copied. This spec pins the
 * derivation: exactly the registry's chains show up, shaped as ChainConfig.
 */

import { CHAIN_CONFIGS } from './types';

describe('CHAIN_CONFIGS', () => {
  it('contains exactly the 7 registry chains', () => {
    expect(Object.keys(CHAIN_CONFIGS).sort()).toEqual(
      ['arbitrum', 'base', 'bitcoin', 'ethereum', 'polygon', 'solana', 'tron'].sort(),
    );
  });

  it("derives bitcoin's config with 8 decimals", () => {
    expect(CHAIN_CONFIGS.bitcoin).toMatchObject({
      id: 'bitcoin',
      name: 'Bitcoin',
      nativeCurrency: { symbol: 'BTC', decimals: 8 },
    });
  });
});
