import { BlockchainProvider } from './BlockchainProvider';
import { EtherscanProvider } from './EtherscanProvider';
import { RateLimiter } from './RateLimiter';
import { ResponseCache } from './ResponseCache';
import { CHAIN_CONFIGS } from './types';

class ProviderRegistryImpl {
  private providers = new Map<string, BlockchainProvider>();
  private rateLimiter = new RateLimiter(5, 5);
  private cache = new ResponseCache();

  get(chainId: string): BlockchainProvider {
    let provider = this.providers.get(chainId);
    if (!provider) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) throw new Error(`Unknown chain: ${chainId}`);
      provider = new EtherscanProvider(config, this.rateLimiter, this.cache);
      this.providers.set(chainId, provider);
    }
    return provider;
  }

  getAvailableChains(): string[] {
    return Object.keys(CHAIN_CONFIGS);
  }
}

export const providerRegistry = new ProviderRegistryImpl();
