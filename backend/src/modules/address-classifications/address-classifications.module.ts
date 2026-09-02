import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AddressClassificationEntity } from '../../database/entities/address-classification.entity';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AddressClassificationsController } from './address-classifications.controller';
import { AddressClassificationsService } from './address-classifications.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AddressClassificationEntity]),
    BlockchainModule,
    // Backs the @Throttle() on POST /addresses/classify — same per-module
    // registration pattern as ExternalTraceModule/AuthEmailModule.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AddressClassificationsController],
  providers: [AddressClassificationsService],
  exports: [AddressClassificationsService],
})
export class AddressClassificationsModule {}
