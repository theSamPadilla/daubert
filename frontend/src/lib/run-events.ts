import { getFirebaseAuth } from './firebase';
import { createSseParser } from './sse';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';
const MAX_CONSECUTIVE_FAILURES = 6;
const RECONNECT_DELAY_MS = 250;

export type SubscriptionResult = 'done' | 'aborted' | 'lost';

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const currentUser = getFirebaseAuth().currentUser;
    if (currentUser) return { Authorization: `Bearer ${await currentUser.getIdToken()}` };
  } catch {
    // Firebase not initialized or token refresh failed — proceed without auth
  }
  return {};
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * Follow a run's events until its `done` event. The server ends each
 * subscription after a few minutes, and networks drop, so this reconnects from
 * the last seen event id until the run finishes. Returns 'lost' on a 4xx or
 * after repeated failures (the run keeps going server-side), and 'aborted' if
 * `signal` fires.
 */
export async function subscribeRunEvents(opts: {
  conversationId: string;
  runId: string;
  after?: number;
  signal: AbortSignal;
  onEvent: (type: string, data: any) => void;
  fetchImpl?: typeof fetch;
  retryDelayMs?: (attempt: number) => number;
}): Promise<SubscriptionResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const retryDelay = opts.retryDelayMs ?? ((n: number) => Math.min(1000 * 2 ** n, 10_000));
  let cursor = opts.after ?? 0;
  let failures = 0;

  while (!opts.signal.aborted) {
    try {
      const res = await fetchFn(
        `${API_BASE}/conversations/${opts.conversationId}/runs/${opts.runId}/events?after=${cursor}`,
        { headers: await authHeaders(), signal: opts.signal },
      );
      if (res.status >= 400 && res.status < 500) return 'lost';
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.feed(decoder.decode(value, { stream: true }))) {
          if (frame.id !== null) cursor = Number(frame.id);
          failures = 0;
          opts.onEvent(frame.event, frame.data ? JSON.parse(frame.data) : {});
          if (frame.event === 'done') return 'done';
        }
      }
      // Ended without done: the server rotated the subscription. Reconnect.
      failures = 0;
      await sleep(RECONNECT_DELAY_MS, opts.signal);
    } catch {
      if (opts.signal.aborted) return 'aborted';
      failures += 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) return 'lost';
      await sleep(retryDelay(failures - 1), opts.signal);
    }
  }
  return 'aborted';
}
