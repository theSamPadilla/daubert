import { Module } from '@nestjs/common';
import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './blockchain.service';
import { ProviderRegistry } from './provider-registry';

@Module({
  controllers: [BlockchainController],
  providers: [ProviderRegistry, BlockchainService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
