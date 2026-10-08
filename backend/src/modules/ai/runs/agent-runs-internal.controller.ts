import { Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { CloudTasksOidcGuard } from './cloud-tasks-oidc.guard';
import { AgentRunExecutor } from './agent-run-executor.service';

/**
 * Cloud Tasks delivery target. The run executes inside this request, so the
 * response is sent only when the run ends. It always returns 2xx once the run
 * was claimed (failures are recorded on the run); only a pre-claim error
 * (e.g. DB unreachable) returns 5xx, so that Cloud Tasks retries the delivery.
 */
@Controller('internal/agent-runs')
export class AgentRunsInternalController {
  constructor(private readonly executor: AgentRunExecutor) {}

  @Public()
  @UseGuards(CloudTasksOidcGuard)
  @Post(':runId/execute')
  @HttpCode(200)
  async execute(@Param('runId', ParseUUIDPipe) runId: string): Promise<{ ok: true }> {
    await this.executor.execute(runId);
    return { ok: true };
  }
}
