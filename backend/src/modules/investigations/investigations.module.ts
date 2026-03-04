import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';

@Module({
  imports: [TypeOrmModule.forFeature([InvestigationEntity, CaseEntity])],
  controllers: [InvestigationsController],
  providers: [InvestigationsService],
})
export class InvestigationsModule {}
