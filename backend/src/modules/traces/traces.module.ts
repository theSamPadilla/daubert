import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { TracesController } from './traces.controller';
import { TracesService } from './traces.service';

@Module({
  imports: [TypeOrmModule.forFeature([TraceEntity, InvestigationEntity])],
  controllers: [TracesController],
  providers: [TracesService],
})
export class TracesModule {}
