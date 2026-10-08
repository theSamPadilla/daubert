import { AgentRunExecutor, HEARTBEAT_MS, RUN_TIME_LIMIT_MS } from './agent-run-executor.service';

const RUN = {
  id: 'run-1', conversationId: 'conv-1', userId: 'user-1', userMessageId: 'msg-1',
  caseId: 'case-1', investigationId: null, model: null, viewerRole: 'editor',
};

describe('AgentRunExecutor', () => {
  let runs: any;
  let ai: any;
  let executor: AgentRunExecutor;
  let appended: any[];

  beforeEach(() => {
    jest.useFakeTimers();
    appended = [];
    runs = {
      claim: jest.fn().mockResolvedValue(RUN),
      heartbeat: jest.fn().mockResolvedValue('ok'),
      appendEvents: jest.fn(async (_id: string, rows: any[]) => { appended.push(...rows); }),
      finish: jest.fn().mockResolvedValue(undefined),
    };
    ai = { runTurn: jest.fn() };
    executor = new AgentRunExecutor(runs, ai);
  });
  afterEach(() => jest.useRealTimers());

  const types = () => appended.map((r) => r.type);
  const waitForAbort = (signal: AbortSignal) =>
    new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));

  it('does nothing when the run cannot be claimed', async () => {
    runs.claim.mockResolvedValue(null);
    await executor.execute('run-1');
    expect(ai.runTurn).not.toHaveBeenCalled();
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it('writes events then done and finishes as succeeded', async () => {
    ai.runTurn.mockImplementation(async function* () {
      yield { type: 'tool_start', data: { name: 'x' } };
      yield { type: 'tool_done', data: { name: 'x' } };
    });
    await executor.execute('run-1');
    expect(types()).toEqual(['tool_start', 'tool_done', 'done']);
    expect(appended.at(-1).data).toEqual({ conversationId: 'conv-1', status: 'succeeded' });
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'succeeded', null);
    expect(ai.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1', userId: 'user-1', userMessageId: 'msg-1', caseId: 'case-1',
      investigationId: undefined, model: undefined, viewerRole: 'editor',
    }));
  });

  it('records a failure with an errorId when the turn throws', async () => {
    ai.runTurn.mockImplementation(async function* () { throw new Error('boom'); });
    await executor.execute('run-1');
    expect(types()).toEqual(['error', 'done']);
    expect(appended[0].data.errorId).toEqual(expect.any(String));
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'failed', expect.objectContaining({ errorId: appended[0].data.errorId }));
  });

  it('aborts with "cancelled" when the heartbeat sees a cancel request', async () => {
    runs.heartbeat.mockResolvedValue('cancel_requested');
    let reason: unknown;
    ai.runTurn.mockImplementation(async function* ({ signal }: any) {
      await waitForAbort(signal);
      reason = signal.reason;
    });
    const done = executor.execute('run-1');
    await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await done;
    expect(reason).toBe('cancelled');
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'cancelled', null);
    expect(appended.at(-1).data.status).toBe('cancelled');
  });

  it('stops quietly when the lease is lost: no done event, no finish', async () => {
    runs.heartbeat.mockResolvedValue('lost');
    ai.runTurn.mockImplementation(async function* ({ signal }: any) { await waitForAbort(signal); });
    const done = executor.execute('run-1');
    await jest.advanceTimersByTimeAsync(HEARTBEAT_MS);
    await done;
    expect(types()).not.toContain('done');
    expect(runs.finish).not.toHaveBeenCalled();
  });

  it('times out with status timed_out', async () => {
    ai.runTurn.mockImplementation(async function* ({ signal }: any) { await waitForAbort(signal); });
    const done = executor.execute('run-1');
    await jest.advanceTimersByTimeAsync(RUN_TIME_LIMIT_MS);
    await done;
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'timed_out', null);
  });
});
