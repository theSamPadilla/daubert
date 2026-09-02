import { TokenResolver } from './token-resolver';

// A WELL_KNOWN entry: USDC on Ethereum.
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
// Not in WELL_KNOWN on any chain.
const UNLISTED = '0x1234567890123456789012345678901234567890';

describe('TokenResolver', () => {
  describe('resolveFromTransfer', () => {
    it('prefers WELL_KNOWN over probe-supplied values, even wrong ones', () => {
      const resolver = new TokenResolver();
      // A probe claiming 0 decimals / empty symbol for USDC must not win —
      // the curated table is known-good and a probe can legitimately come
      // back empty or wrong.
      const meta = resolver.resolveFromTransfer('ethereum', USDC, '', 0);
      expect(meta).toMatchObject({ symbol: 'USDC', decimals: 6 });
    });

    it('returns but does not cache an empty-symbol probe result, so a later good probe replaces it', () => {
      const resolver = new TokenResolver();

      const first = resolver.resolveFromTransfer('ethereum', UNLISTED, '', 0);
      expect(first).toEqual({ address: UNLISTED.toLowerCase(), symbol: '', decimals: 0 });

      // A subsequent good probe must not be shadowed by the failed one.
      const second = resolver.resolveFromTransfer('ethereum', UNLISTED, 'FOO', 18);
      expect(second).toEqual({ address: UNLISTED.toLowerCase(), symbol: 'FOO', decimals: 18 });
    });

    it('caches a good probe result, so a later empty-symbol probe does not overwrite it', () => {
      const resolver = new TokenResolver();

      const first = resolver.resolveFromTransfer('ethereum', UNLISTED, 'FOO', 18);
      expect(first).toEqual({ address: UNLISTED.toLowerCase(), symbol: 'FOO', decimals: 18 });

      const second = resolver.resolveFromTransfer('ethereum', UNLISTED, '', 0);
      expect(second).toEqual(first);
    });
  });
});
