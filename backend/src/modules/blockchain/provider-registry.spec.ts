import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from './provider-registry';
import { BitcoinProvider } from './bitcoin.provider';
import { HeliusProvider } from './helius.provider';

function stubConfigService(): ConfigService {
  return {
    get: jest.fn().mockReturnValue(''),
  } as unknown as ConfigService;
}

describe('ProviderRegistry', () => {
  describe('getUtxo', () => {
    it('returns a BitcoinProvider for chainId "bitcoin" and caches it', () => {
      const registry = new ProviderRegistry(stubConfigService());

      const first = registry.getUtxo('bitcoin');
      const second = registry.getUtxo('bitcoin');

      expect(first).toBeInstanceOf(BitcoinProvider);
      expect(first).toBe(second);
    });

    it('throws for any chainId without a UTXO provider', () => {
      const registry = new ProviderRegistry(stubConfigService());

      expect(() => registry.getUtxo('ethereum')).toThrow(
        'Chain ethereum has no UTXO provider',
      );
    });
  });

  describe('get', () => {
    it('still throws the UTXO-path guard error for "bitcoin"', () => {
      const registry = new ProviderRegistry(stubConfigService());

      expect(() => registry.get('bitcoin')).toThrow(
        'bitcoin uses the UTXO provider path (getUtxo)',
      );
    });

    it('throws the Solana-path guard error for "solana"', () => {
      const registry = new ProviderRegistry(stubConfigService());

      expect(() => registry.get('solana')).toThrow(
        'solana uses the Solana provider path (getSolana)',
      );
    });
  });

  describe('getSolana', () => {
    it('returns a HeliusProvider for chainId "solana" and caches it', () => {
      const registry = new ProviderRegistry(stubConfigService());

      const first = registry.getSolana('solana');
      const second = registry.getSolana('solana');

      expect(first).toBeInstanceOf(HeliusProvider);
      expect(first).toBe(second);
    });

    it('throws for any chainId without a Solana provider', () => {
      const registry = new ProviderRegistry(stubConfigService());

      expect(() => registry.getSolana('ethereum')).toThrow(
        'Chain ethereum has no Solana provider',
      );
    });

    it('still throws the Solana-path guard error via get("solana")', () => {
      const registry = new ProviderRegistry(stubConfigService());

      registry.getSolana('solana');

      expect(() => registry.get('solana')).toThrow(
        'solana uses the Solana provider path (getSolana)',
      );
    });
  });
});
