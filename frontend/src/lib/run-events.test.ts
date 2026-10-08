import { subscribeRunEvents } from './run-events';

jest.mock('./firebase', () => ({ getFirebaseAuth: () => ({ currentUser: null }) }));

const sse = (...chunks: string[]) =>
  new Response(new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  }), { status: 200 });

describe('subscribeRunEvents', () => {
  const base = { conversationId: 'c1', runId: 'r1', retryDelayMs: () => 0 };

  it('delivers events and resolves done on the done event', async () => {
    const seen: string[] = [];
    const fetchImpl = jest.fn().mockResolvedValue(sse(
      'id: 1\nevent: text_delta\ndata: {"content":"a"}\n\n',
      'id: 2\nevent: done\ndata: {"status":"succeeded"}\n\n',
    ));
    const result = await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: (t) => seen.push(t) });
    expect(result).toBe('done');
    expect(seen).toEqual(['text_delta', 'done']);
  });

  it('reconnects from the last id when the stream ends without done', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(sse('id: 5\nevent: tool_start\ndata: {}\n\n'))
      .mockResolvedValueOnce(sse('id: 6\nevent: done\ndata: {}\n\n'));
    const result = await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: () => {} });
    expect(result).toBe('done');
    expect(fetchImpl.mock.calls[1][0]).toContain('/conversations/c1/runs/r1/events?after=5');
  });

  it('returns lost on a 4xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: () => {} })).toBe('lost');
  });

  it('returns lost after repeated network failures', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await subscribeRunEvents({ ...base, signal: new AbortController().signal, fetchImpl, onEvent: () => {} })).toBe('lost');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('returns aborted when the signal fires', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    expect(await subscribeRunEvents({ ...base, signal: controller.signal, fetchImpl, onEvent: () => {} })).toBe('aborted');
  });
});
