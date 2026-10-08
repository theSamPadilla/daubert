import { createAgentRunDispatcher } from './dispatcher.factory';
import { InProcessAgentRunDispatcher } from './in-process.dispatcher';
import { CloudTasksAgentRunDispatcher, DISPATCH_DEADLINE_SECONDS } from './cloud-tasks.dispatcher';

const config = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] }) as any;
const executor = { execute: jest.fn().mockResolvedValue(undefined) } as any;

describe('createAgentRunDispatcher', () => {
  it('uses in-process dispatch outside production when no queue is configured', () => {
    expect(createAgentRunDispatcher(config({ NODE_ENV: 'development' }), executor)).toBeInstanceOf(InProcessAgentRunDispatcher);
  });

  it('refuses to start in production without a queue', () => {
    expect(() => createAgentRunDispatcher(config({ NODE_ENV: 'production' }), executor)).toThrow(/AGENT_RUNS_QUEUE/);
  });

  it('uses Cloud Tasks when a queue is configured', () => {
    const d = createAgentRunDispatcher(config({
      NODE_ENV: 'production',
      AGENT_RUNS_QUEUE: 'projects/p/locations/us-central1/queues/agent-runs',
      AGENT_RUNS_WORKER_URL: 'https://svc.run.app',
      AGENT_RUNS_INVOKER_SA: 'invoker@p.iam.gserviceaccount.com',
    }), executor);
    expect(d).toBeInstanceOf(CloudTasksAgentRunDispatcher);
  });
});

describe('CloudTasksAgentRunDispatcher', () => {
  it('creates a named, OIDC-authenticated task for the run', async () => {
    const client = { createTask: jest.fn().mockResolvedValue([{}]) };
    const d = new CloudTasksAgentRunDispatcher('projects/p/locations/l/queues/q', 'https://svc.run.app', 'inv@p.iam.gserviceaccount.com', client as any);
    await d.dispatch('run-1');
    expect(client.createTask).toHaveBeenCalledWith({
      parent: 'projects/p/locations/l/queues/q',
      task: {
        name: 'projects/p/locations/l/queues/q/tasks/run-run-1',
        dispatchDeadline: { seconds: DISPATCH_DEADLINE_SECONDS },
        httpRequest: {
          httpMethod: 'POST',
          url: 'https://svc.run.app/internal/agent-runs/run-1/execute',
          oidcToken: { serviceAccountEmail: 'inv@p.iam.gserviceaccount.com', audience: 'https://svc.run.app' },
        },
      },
    });
  });
});

describe('InProcessAgentRunDispatcher', () => {
  it('executes the run asynchronously', async () => {
    const d = new InProcessAgentRunDispatcher(executor);
    await d.dispatch('run-2');
    await new Promise((r) => setImmediate(r));
    expect(executor.execute).toHaveBeenCalledWith('run-2');
  });
});
