import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TokenUsageEntity } from '../../../database/entities/token-usage.entity';
import { MonthlyUsageEntity } from '../../../database/entities/monthly-usage.entity';
import { TokenUsageService } from './token-usage.service';
import { SuperadminTokenUsageController } from './token-usage.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TokenUsageEntity, MonthlyUsageEntity])],
  controllers: [SuperadminTokenUsageController],
  providers: [TokenUsageService],
  exports: [TokenUsageService],
})
export class TokenUsageModule {}
