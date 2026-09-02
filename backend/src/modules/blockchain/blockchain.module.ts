import { Module } from '@nestjs/common';
import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './blockchain.service';
import { ProviderRegistry } from './provider-registry';

@Module({
  controllers: [BlockchainController],
  providers: [ProviderRegistry, BlockchainService],
  // ProviderRegistry is exported (not just BlockchainService) so
  // AddressClassificationsModule can probe addresses through the same
  // singleton registry — and therefore the same rate limiter and response
  // cache — that fetch-history uses, rather than standing up a second one.
  exports: [BlockchainService, ProviderRegistry],
})
export class BlockchainModule {}
