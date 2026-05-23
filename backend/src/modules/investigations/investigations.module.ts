import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';
import { AuthModule } from '../auth/auth.module';
import { TracesModule } from '../traces/traces.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvestigationEntity, CaseEntity, ScriptRunEntity, TraceEntity]),
    AuthModule,
    TracesModule,
  ],
  controllers: [InvestigationsController],
  providers: [InvestigationsService],
  exports: [InvestigationsService],
})
export class InvestigationsModule {}
