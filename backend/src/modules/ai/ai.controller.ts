import { Controller, Param, Post, Req, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { ScriptExecutionService } from './services/script-execution.service';
import { CaseAccessService } from '../auth/case-access.service';
import { getPrincipal } from '../auth/access-principal';
import { CaseRole } from '../../database/entities/case-member.entity';

@Controller()
export class AiController {
  constructor(
    private readonly scriptExecutionService: ScriptExecutionService,
    private readonly caseAccess: CaseAccessService,
    @InjectRepository(ScriptRunEntity)
    private readonly scriptRunRepo: Repository<ScriptRunEntity>,
  ) {}

  @Post('script-runs/:id/rerun')
  async rerun(@Param('id') id: string, @Req() req: any) {
    const run = await this.scriptRunRepo.findOneBy({ id });
    if (!run) throw new NotFoundException(`Script run ${id} not found`);

    const principal = getPrincipal(req);
    const membership = await this.caseAccess.assertRole(principal, run.caseId, 'editor');
    // For user principals, assertRole returned the membership; for script
    // principals it returned null and the role lives on the principal itself.
    const role: CaseRole =
      principal.kind === 'script' ? principal.role : membership!.role;

    const { savedRun } = await this.scriptExecutionService.execute(
      run.caseId,
      run.investigationId ?? undefined,
      run.name,
      run.code,
      role,
    );
    return savedRun;
  }
}
