import { Controller, Param, Post, Req, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { ScriptExecutionService } from './services/script-execution.service';
import { CaseAccessService } from '../auth/case-access.service';

@Controller()
export class AiController {
  constructor(
    private readonly scriptExecutionService: ScriptExecutionService,
    private readonly caseAccess: CaseAccessService,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
    @InjectRepository(InvestigationEntity)
    private readonly invRepo: Repository<InvestigationEntity>,
  ) {}

  @Post('script-runs/:id/rerun')
  async rerun(@Param('id') id: string, @Req() req: any) {
    const run = await this.scriptRunRepo.findOneBy({ id });
    if (!run) throw new NotFoundException(`Script run ${id} not found`);

    // Verify case access: script run → investigation → case
    if (req.user) {
      const inv = await this.invRepo.findOneBy({ id: run.investigationId });
      if (inv) await this.caseAccess.assertAccess(req.user.id, inv.caseId);
    }

    const { savedRun } = await this.scriptExecutionService.execute(
      run.investigationId,
      run.name,
      run.code,
    );
    return savedRun;
  }
}
