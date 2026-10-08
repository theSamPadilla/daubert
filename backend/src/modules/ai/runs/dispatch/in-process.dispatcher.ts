import { Logger } from '@nestjs/common';
import { AgentRunDispatcher } from './agent-run-dispatcher';
import type { AgentRunExecutor } from '../agent-run-executor.service';

/**
 * Dev-only: runs execute in this process after the POST returns. On Cloud Run
 * that would be unprotected background work, so the factory refuses it in
 * production.
 */
export class InProcessAgentRunDispatcher implements AgentRunDispatcher {
  private readonly logger = new Logger(InProcessAgentRunDispatcher.name);

  constructor(private readonly executor: AgentRunExecutor) {}

  async dispatch(runId: string): Promise<void> {
    setImmediate(() => {
      this.executor.execute(runId).catch((err) =>
        this.logger.error(`in_process_run_failed runId=${runId}`, err instanceof Error ? err.stack : String(err)),
      );
    });
  }
}
