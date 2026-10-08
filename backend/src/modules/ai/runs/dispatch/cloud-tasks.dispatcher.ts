import { CloudTasksClient } from '@google-cloud/tasks';
import { AgentRunDispatcher } from './agent-run-dispatcher';

/** Cloud Tasks' maximum for HTTP targets. The run itself stops at 25 min. */
export const DISPATCH_DEADLINE_SECONDS = 1800;

/**
 * Enqueues one task per run that POSTs to the internal execute endpoint. The
 * run executes inside that request, which Cloud Run keeps alive through
 * deploys and scale-in. Task names derive from the run id, so a duplicate
 * dispatch is rejected by Cloud Tasks instead of running twice.
 */
export class CloudTasksAgentRunDispatcher implements AgentRunDispatcher {
  constructor(
    private readonly queue: string,
    private readonly workerUrl: string,
    private readonly invokerEmail: string,
    private readonly client: Pick<CloudTasksClient, 'createTask'> = new CloudTasksClient(),
  ) {}

  async dispatch(runId: string): Promise<void> {
    await this.client.createTask({
      parent: this.queue,
      task: {
        name: `${this.queue}/tasks/run-${runId}`,
        dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
        httpRequest: {
          httpMethod: 'POST',
          url: `${this.workerUrl}/internal/agent-runs/${runId}/execute`,
          oidcToken: { serviceAccountEmail: this.invokerEmail, audience: this.workerUrl },
        },
      },
    });
  }
}
