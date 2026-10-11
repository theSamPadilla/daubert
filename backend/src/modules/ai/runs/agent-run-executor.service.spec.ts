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

  it('passes runTurn a deadline at run start plus RUN_TIME_LIMIT_MS', async () => {
    jest.setSystemTime(new Date('2026-10-11T12:00:00Z'));
    const startedAt = Date.now();
    ai.runTurn.mockImplementation(async function* () { /* no events */ });
    await executor.execute('run-1');
    expect(ai.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      deadlineAt: startedAt + RUN_TIME_LIMIT_MS,
    }));
  });

  it('records a failure with an errorId when the turn throws', async () => {
    ai.runTurn.mockImplementation(async function* () { throw new Error('boom'); });
    await executor.execute('run-1');
    expect(types()).toEqual(['error', 'done']);
    expect(appended[0].data.errorId).toEqual(expect.any(String));
    expect(runs.finish).toHaveBeenCalledWith('run-1', 'failed', expect.objectContaining({ errorId: appended[0].data.errorId }));
  });

  describe('failure classification', () => {
    const failWith = (err: unknown) => {
      ai.runTurn.mockImplementation(async function* () { throw err; });
    };
    const apiError = (status: number, message: string) =>
      Object.assign(new Error(`${status} ${JSON.stringify({ type: 'error', error: { message } })}`), {
        status, error: { type: 'error', error: { type: 'invalid_request_error', message } },
      });
    const errorEvent = () => appended.find((r) => r.type === 'error').data;

    it('classifies "prompt is too long" as context_overflow', async () => {
      failWith(apiError(400, 'prompt is too long: 1296920 tokens > 1000000 maximum'));
      await executor.execute('run-1');
      expect(errorEvent()).toMatchObject({
        code: 'context_overflow',
        message: 'This conversation is too long for the AI to process. Continue in a new conversation to keep going.',
      });
      expect(runs.finish).toHaveBeenCalledWith('run-1', 'failed', expect.objectContaining({
        code: 'context_overflow', errorId: errorEvent().errorId,
      }));
    });

    it('matches context_overflow found only in err.error.error.message, at a non-400 status', async () => {
      failWith(Object.assign(new Error('Request failed'), {
        status: 413, error: { error: { type: 'request_too_large', message: 'Request exceeds the context window' } },
      }));
      await executor.execute('run-1');
      expect(errorEvent().code).toBe('context_overflow');
    });

    it('classifies an exhausted credit balance as service_unavailable and logs the alert tag', async () => {
      const logError = jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
      failWith(apiError(400, 'Your credit balance is too low to access the Anthropic API.'));
      await executor.execute('run-1');
      expect(errorEvent()).toMatchObject({
        code: 'service_unavailable',
        message: 'The AI service is temporarily unavailable. Contact support if this persists.',
      });
      expect(runs.finish).toHaveBeenCalledWith('run-1', 'failed', expect.objectContaining({ code: 'service_unavailable' }));
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('anthropic_credit_exhausted'));
    });

    it('classifies anything else as unknown with the generic message', async () => {
      failWith(apiError(500, 'Internal server error'));
      await executor.execute('run-1');
      expect(errorEvent()).toMatchObject({
        code: 'unknown',
        message: 'An error occurred and has been logged. Please try again.',
      });
      expect(runs.finish).toHaveBeenCalledWith('run-1', 'failed', expect.objectContaining({ code: 'unknown' }));
    });

    it('logs the message in run_failed_detail when the error has no structured fields', async () => {
      const logError = jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
      failWith(new Error('socket hang up'));
      await executor.execute('run-1');
      const detail = logError.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('run_failed_detail'));
      expect(detail).toContain('"message":"socket hang up"');
    });

    it('leaves the message out of run_failed_detail for structured errors', async () => {
      const logError = jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
      failWith(apiError(500, 'Internal server error'));
      await executor.execute('run-1');
      const detail = logError.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('run_failed_detail'));
      expect(detail).toContain('"status":500');
      expect(detail).not.toContain('"message":"500');
    });
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
