import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { ExternalTraceController } from './external-trace.controller';
import { ExternalTraceService } from './external-trace.service';
import { WebsiteKeyGuard } from './website-key.guard';
import { ForwardedIpThrottlerGuard } from './forwarded-ip.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', limit: 10, ttl: 60_000 }]),
    BlockchainModule,
    LabeledEntitiesModule,
  ],
  controllers: [ExternalTraceController],
  providers: [ExternalTraceService, WebsiteKeyGuard, ForwardedIpThrottlerGuard],
})
export class ExternalTraceModule {}
