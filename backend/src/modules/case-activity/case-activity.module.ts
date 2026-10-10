import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseActivityLogEntity } from '../../database/entities/case-activity-log.entity';
import { AuthModule } from '../auth/auth.module';
import { CaseActivityController } from './case-activity.controller';
import { CaseActivityService } from './case-activity.service';

@Module({
  imports: [TypeOrmModule.forFeature([CaseActivityLogEntity]), AuthModule],
  controllers: [CaseActivityController],
  providers: [CaseActivityService],
  exports: [CaseActivityService],
})
export class CaseActivityModule {}
