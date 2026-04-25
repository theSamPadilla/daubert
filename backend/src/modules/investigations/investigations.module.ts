import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvestigationEntity, CaseEntity, ScriptRunEntity]),
    AuthModule,
  ],
  controllers: [InvestigationsController],
  providers: [InvestigationsService],
})
export class InvestigationsModule {}
