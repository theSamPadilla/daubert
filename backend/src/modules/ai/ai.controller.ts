// backend/src/modules/ai/ai.controller.ts
import { Controller, Param, Post, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { ScriptExecutionService } from './services/script-execution.service';

@Controller()
export class AiController {
  constructor(
    private readonly scriptExecutionService: ScriptExecutionService,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
  ) {}

  @Post('script-runs/:id/rerun')
  async rerun(@Param('id') id: string) {
    const run = await this.scriptRunRepo.findOneBy({ id });
    if (!run) throw new NotFoundException(`Script run ${id} not found`);
    const { savedRun } = await this.scriptExecutionService.execute(
      run.investigationId,
      run.name,
      run.code,
    );
    return savedRun;
  }
}
