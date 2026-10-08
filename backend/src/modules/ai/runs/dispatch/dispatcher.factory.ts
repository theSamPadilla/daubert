import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AGENT_RUN_DISPATCHER, AgentRunDispatcher } from './agent-run-dispatcher';
import { CloudTasksAgentRunDispatcher } from './cloud-tasks.dispatcher';
import { InProcessAgentRunDispatcher } from './in-process.dispatcher';
import { AgentRunExecutor } from '../agent-run-executor.service';

export function createAgentRunDispatcher(
  config: ConfigService,
  executor: AgentRunExecutor,
): AgentRunDispatcher {
  const queue = config.get<string>('AGENT_RUNS_QUEUE');
  if (queue) {
    return new CloudTasksAgentRunDispatcher(
      queue,
      config.get<string>('AGENT_RUNS_WORKER_URL')!,
      config.get<string>('AGENT_RUNS_INVOKER_SA')!,
    );
  }
  if (config.get<string>('NODE_ENV') !== 'production') return new InProcessAgentRunDispatcher(executor);
  throw new Error('AGENT_RUNS_QUEUE required in production');
}

export const agentRunDispatcherProvider: Provider = {
  provide: AGENT_RUN_DISPATCHER,
  useFactory: createAgentRunDispatcher,
  inject: [ConfigService, AgentRunExecutor],
};
