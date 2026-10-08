import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ACTIVE_RUN_STATUSES } from '../../../database/entities/agent-run.entity';
import { AgentRunsService } from './agent-runs.service';

export const POLL_MS = 300;
/** Server-side subscription window. Clients reconnect with their last id. */
export const SUBSCRIPTION_MAX_MS = 240_000;
const HEARTBEAT_MS = 15_000;
const STATUS_CHECK_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Relays a run's event log as SSE by polling Postgres. Ends at the run's
 * `done` event, when the client disconnects, or when `maxDurationMs` elapses.
 * Ending without `done` means "reconnect with ?after=<last id>".
 */
@Injectable()
export class AgentRunEventsStreamer {
  private readonly logger = new Logger(AgentRunEventsStreamer.name);

  constructor(private readonly runs: AgentRunsService) {}

  async stream(
    res: Response,
    run: { id: string; conversationId: string },
    after: number,
    maxDurationMs: number,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // res 'close' (not req 'close') fires when the client goes away.
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    // The client may have gone away during the auth/ownership checks, before
    // the listener existed.
    if (res.destroyed || res.socket?.destroyed) closed = true;

    const startedAt = Date.now();
    let cursor = after;
    let lastWriteAt = startedAt;
    let lastStatusCheckAt = startedAt;

    try {
      while (!closed) {
        const events = await this.runs.listEventsAfter(run.id, cursor);
        for (const e of events) {
          res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
          cursor = e.seq;
          lastWriteAt = Date.now();
          if (e.type === 'done') return;
        }
        if (events.length > 0) continue; // drain any backlog before sleeping

        const now = Date.now();
        if (now - startedAt >= maxDurationMs) return;

        if (now - lastStatusCheckAt >= STATUS_CHECK_MS) {
          lastStatusCheckAt = now;
          await this.runs.sweepStale(run.conversationId);
          const status = await this.runs.getStatus(run.id);
          if (status && !ACTIVE_RUN_STATUSES.includes(status)) {
            const tail = await this.runs.listEventsAfter(run.id, cursor);
            if (tail.length > 0) continue;
            // Terminal, but its done event was never written: close the turn.
            res.write(`event: done\ndata: ${JSON.stringify({ conversationId: run.conversationId, status })}\n\n`);
            return;
          }
        }

        if (now - lastWriteAt >= HEARTBEAT_MS) {
          res.write(': heartbeat\n\n');
          lastWriteAt = now;
        }
        await sleep(POLL_MS);
      }
    } catch (err) {
      this.logger.warn(`run_stream_failed runId=${run.id}: ${String(err)}`);
    } finally {
      res.end();
    }
  }
}
