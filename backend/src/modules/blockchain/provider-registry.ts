import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockchainProvider } from './blockchain-provider';
import { EtherscanProvider } from './etherscan.provider';
import { TronscanProvider } from './tronscan.provider';
import { BitcoinProvider } from './bitcoin.provider';
import { UtxoProvider } from './utxo-provider';
import { HeliusProvider } from './helius.provider';
import { HeliusClient } from './helius-client';
import { SolanaProvider } from './solana-provider';
import { RateLimiter } from './rate-limiter';
import { ResponseCache } from './response-cache';
import { CHAIN_CONFIGS } from './types';

@Injectable()
export class ProviderRegistry {
  private providers = new Map<string, BlockchainProvider>();
  private utxoProviders = new Map<string, UtxoProvider>();
  private solanaProviders = new Map<string, SolanaProvider>();
  private rateLimiter = new RateLimiter(5, 5);
  private cache = new ResponseCache();
  private etherscanApiKey: string;
  private tronscanApiKey: string;
  private heliusApiKey: string;

  constructor(private configService: ConfigService) {
    this.etherscanApiKey =
      this.configService.get<string>('ETHERSCAN_API_KEY') || '';
    this.tronscanApiKey =
      this.configService.get<string>('TRONSCAN_API_KEY') || '';
    this.heliusApiKey = this.configService.get<string>('HELIUS_API_KEY') || '';
  }

  get(chainId: string): BlockchainProvider {
    let provider = this.providers.get(chainId);
    if (!provider) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) throw new Error(`Unknown chain: ${chainId}`);

      // Bitcoin is in CHAIN_CONFIGS (derived from the shared registry) but has
      // no Etherscan/Tronscan-style provider — it uses the UTXO provider path
      // (getUtxo), added in a later task. Guard the transient window so this
      // doesn't fall through to EtherscanProvider.
      if (chainId === 'bitcoin') {
        throw new Error('bitcoin uses the UTXO provider path (getUtxo)');
      }

      // Solana is in CHAIN_CONFIGS but has no Etherscan/Tronscan-style
      // provider — it uses the Solana provider path (getSolana), added in a
      // later task. Guard the transient window so this doesn't fall through
      // to EtherscanProvider.
      if (chainId === 'solana') {
        throw new Error('solana uses the Solana provider path (getSolana)');
      }

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

  getUtxo(chainId: string): UtxoProvider {
    let provider = this.utxoProviders.get(chainId);
    if (!provider) {
      if (chainId === 'bitcoin') {
        provider = new BitcoinProvider();
      } else {
        throw new Error(`Chain ${chainId} has no UTXO provider`);
      }
      this.utxoProviders.set(chainId, provider);
    }
    return provider;
  }

  getSolana(chainId: string): SolanaProvider {
    let provider = this.solanaProviders.get(chainId);
    if (!provider) {
      if (chainId === 'solana') {
        provider = new HeliusProvider(new HeliusClient(this.heliusApiKey));
      } else {
        throw new Error(`Chain ${chainId} has no Solana provider`);
      }
      this.solanaProviders.set(chainId, provider);
    }
    return provider;
  }
}
