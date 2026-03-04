import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockchainProvider } from './blockchain-provider';
import { EtherscanProvider } from './etherscan.provider';
import { TronscanProvider } from './tronscan.provider';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';
import { CHAIN_CONFIGS } from './types';

@Injectable()
export class ProviderRegistry {
  private providers = new Map<string, BlockchainProvider>();
  private rateLimiter = new RateLimiter(5, 5);
  private cache = new ResponseCache();
  private etherscanApiKey: string;
  private tronscanApiKey: string;

  constructor(private configService: ConfigService) {
    this.etherscanApiKey =
      this.configService.get<string>('ETHERSCAN_API_KEY') || '';
    this.tronscanApiKey =
      this.configService.get<string>('TRONSCAN_API_KEY') || '';
  }

  get(chainId: string): BlockchainProvider {
    let provider = this.providers.get(chainId);
    if (!provider) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) throw new Error(`Unknown chain: ${chainId}`);

      if (chainId === 'tron') {
        provider = new TronscanProvider(
          this.tronscanApiKey,
          this.rateLimiter,
          this.cache,
        );
      } else {
        provider = new EtherscanProvider(
          config,
          this.etherscanApiKey,
          this.rateLimiter,
          this.cache,
        );
      }
      this.providers.set(chainId, provider);
    }
    return provider;
  }

  getCache(): ResponseCache {
    return this.cache;
  }

  getAvailableChains(): string[] {
    return Object.keys(CHAIN_CONFIGS);
  }
}
