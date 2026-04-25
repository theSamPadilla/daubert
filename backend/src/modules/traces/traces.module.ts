import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { TracesController } from './traces.controller';
import { TracesService } from './traces.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TraceEntity, InvestigationEntity]),
    AuthModule,
  ],
  controllers: [TracesController],
  providers: [TracesService],
})
export class TracesModule {}
