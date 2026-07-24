import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductionEntity } from '../../database/entities/production.entity';
import { ProductionsController } from './productions.controller';
import { ProductionsService } from './productions.service';
import { RedlineIngestService } from './redline-ingest.service';
import { AuthModule } from '../auth/auth.module';
import { DataRoomModule } from '../data-room/data-room.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductionEntity]),
    AuthModule,
    DataRoomModule,
  ],
  controllers: [ProductionsController],
  providers: [ProductionsService, RedlineIngestService],
  exports: [ProductionsService],
})
export class ProductionsModule {}
