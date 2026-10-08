import { EventEmitter } from 'events';
import { AgentRunEventsStreamer, POLL_MS } from './agent-run-events.streamer';

const RUN = { id: 'run-1', conversationId: 'conv-1' };
const ev = (seq: number, type: string, data: unknown = {}) => ({ runId: 'run-1', seq, type, data });

function fakeRes() {
  const res: any = new EventEmitter();
  res.setHeader = jest.fn();
  res.flushHeaders = jest.fn();
  res.write = jest.fn();
  res.end = jest.fn();
  res.destroyed = false;
  res.socket = { destroyed: false };
  return res;
}

describe('AgentRunEventsStreamer', () => {
  let runs: any;
  let streamer: AgentRunEventsStreamer;

  beforeEach(() => {
    jest.useFakeTimers();
    runs = {
      listEventsAfter: jest.fn().mockResolvedValue([]),
      sweepStale: jest.fn().mockResolvedValue(undefined),
      getStatus: jest.fn().mockResolvedValue('running'),
    };
    streamer = new AgentRunEventsStreamer(runs);
  });
  afterEach(() => jest.useRealTimers());

  it('writes events with ids after the cursor and stops at done', async () => {
    runs.listEventsAfter.mockResolvedValueOnce([ev(4, 'text_delta', { content: 'a' }), ev(5, 'done', { status: 'succeeded' })]);
    const res = fakeRes();
    await streamer.stream(res, RUN, 3, 60_000);
    expect(runs.listEventsAfter).toHaveBeenCalledWith('run-1', 3);
    expect(res.write.mock.calls.map((c: any[]) => c[0])).toEqual([
      'id: 4\nevent: text_delta\ndata: {"content":"a"}\n\n',
      'id: 5\nevent: done\ndata: {"status":"succeeded"}\n\n',
    ]);
    expect(res.end).toHaveBeenCalled();
  });

  it('polls until new events arrive', async () => {
    runs.listEventsAfter.mockResolvedValueOnce([]).mockResolvedValueOnce([ev(1, 'done')]);
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 60_000);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    await p;
    expect(runs.listEventsAfter).toHaveBeenCalledTimes(2);
  });

  it('ends without done when the subscription window elapses', async () => {
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 1_000);
    await jest.advanceTimersByTimeAsync(1_500);
    await p;
    expect(res.write.mock.calls.some((c: any[]) => c[0].includes('event: done'))).toBe(false);
    expect(res.end).toHaveBeenCalled();
  });

  it('synthesizes done when the run is terminal but its done event is missing', async () => {
    runs.getStatus.mockResolvedValue('failed');
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 60_000);
    await jest.advanceTimersByTimeAsync(10_500);
    await p;
    expect(runs.sweepStale).toHaveBeenCalledWith('conv-1');
    expect(res.write).toHaveBeenCalledWith('event: done\ndata: {"conversationId":"conv-1","status":"failed"}\n\n');
  });

  it('does not poll when the client is already gone before the listener attached', async () => {
    const res = fakeRes();
    res.socket = { destroyed: true };
    await streamer.stream(res, RUN, 0, 60_000);
    expect(runs.listEventsAfter).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it('stops polling when the client disconnects', async () => {
    const res = fakeRes();
    const p = streamer.stream(res, RUN, 0, 60_000);
    await jest.advanceTimersByTimeAsync(POLL_MS);
    res.emit('close');
    await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    await p;
    const calls = runs.listEventsAfter.mock.calls.length;
    await jest.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(runs.listEventsAfter.mock.calls.length).toBe(calls);
  });
});
