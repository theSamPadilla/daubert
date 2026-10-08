export const AGENT_RUN_DISPATCHER = Symbol('AGENT_RUN_DISPATCHER');

/** Starts execution of a queued run somewhere other than the caller's request. */
export interface AgentRunDispatcher {
  dispatch(runId: string): Promise<void>;
}
