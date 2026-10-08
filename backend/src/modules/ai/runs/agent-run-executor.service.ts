import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RunError, TerminalRunStatus } from '../../../database/entities/agent-run.entity';
import { AiService } from '../ai.service';
import { AgentRunsService } from './agent-runs.service';
import { RunEventWriter } from './run-event-writer';
import { abortReasonOf, RunAbortReason } from './run-abort';

/** One run's wall-clock budget. Must stay below the Cloud Tasks dispatch deadline (30 min). */
export const RUN_TIME_LIMIT_MS = 25 * 60_000;
/** Lease renewal and cancel-poll interval. */
export const HEARTBEAT_MS = 3_000;

const FAILURE_MESSAGE = 'An error occurred and has been logged. Please try again.';

/**
 * Executes one claimed run to completion: drives AiService.runTurn, writes its
 * events, renews the lease, and routes cancel / time limit / lost lease into
 * the turn's AbortSignal. Always ends the run with a `done` event and a
 * terminal status, except when the lease was lost: then the sweeper owns it.
 */
@Injectable()
export class AgentRunExecutor {
  private readonly logger = new Logger(AgentRunExecutor.name);

  constructor(
    private readonly runs: AgentRunsService,
    private readonly ai: AiService,
  ) {}

  async execute(runId: string): Promise<void> {
    const run = await this.runs.claim(runId);
    if (!run) {
      this.logger.log(`run_skip runId=${runId} reason=not_queued`);
      return;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const abort = (reason: RunAbortReason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const writer = new RunEventWriter((rows) => this.runs.appendEvents(runId, rows));

    const timeLimit = setTimeout(() => abort('time_limit'), RUN_TIME_LIMIT_MS);
    let beating = false;
    const heartbeat = setInterval(() => {
      if (beating) return;
      beating = true;
      this.runs
        .heartbeat(runId)
        .then((state) => {
          if (state === 'lost') abort('lease_lost');
          else if (state === 'cancel_requested') abort('cancelled');
        })
        .catch((err) => this.logger.warn(`run_heartbeat_failed runId=${runId}: ${String(err)}`))
        .finally(() => {
          beating = false;
        });
    }, HEARTBEAT_MS);

    this.logger.log(
      `run_start runId=${runId} conversationId=${run.conversationId} model=${run.model ?? 'default'}`,
    );

    let status: TerminalRunStatus = 'succeeded';
    let error: RunError | null = null;
    try {
      for await (const event of this.ai.runTurn({
        conversationId: run.conversationId,
        userId: run.userId,
        userMessageId: run.userMessageId!, // claim() requires it
        caseId: run.caseId ?? undefined,
        investigationId: run.investigationId ?? undefined,
        model: run.model ?? undefined,
        viewerRole: run.viewerRole,
        signal: controller.signal,
      })) {
        await writer.push(event);
      }
      status = statusForAbort(controller.signal) ?? 'succeeded';
    } catch (err) {
      const aborted = statusForAbort(controller.signal);
      if (aborted) {
        status = aborted;
      } else {
        const errorId = randomUUID();
        this.logger.error(
          `run_failed runId=${runId} errorId=${errorId} conversationId=${run.conversationId} model=${run.model ?? 'default'}`,
          err instanceof Error ? err.stack : String(err),
        );
        // Upstream errors (e.g. Anthropic 400s) carry structured detail on the
        // error object; log it separately so the stack trace stays readable.
        if (err && typeof err === 'object') {
          const e = err as Record<string, unknown>;
          this.logger.error(
            `run_failed_detail [${errorId}]: ${JSON.stringify({
              name: e.name, status: e.status, code: e.code, type: e.type,
              request_id: e.request_id, error: e.error,
            })}`,
          );
        }
        error = { errorId, message: FAILURE_MESSAGE };
        status = 'failed';
      }
    } finally {
      clearTimeout(timeLimit);
      clearInterval(heartbeat);
    }

    if (abortReasonOf(controller.signal) === 'lease_lost') {
      this.logger.warn(`run_lease_lost runId=${runId} durationMs=${Date.now() - startedAt}`);
      return;
    }

    try {
      if (error) await writer.push({ type: 'error', data: { message: error.message, errorId: error.errorId } });
      await writer.push({ type: 'done', data: { conversationId: run.conversationId, status } });
      await writer.flush();
    } catch (err) {
      // Streamers synthesize done from the terminal status if this write failed.
      this.logger.error(`run_events_failed runId=${runId}`, err instanceof Error ? err.stack : String(err));
    } finally {
      await this.runs.finish(runId, status, error);
      this.logger.log(`run_end runId=${runId} status=${status} durationMs=${Date.now() - startedAt}`);
    }
  }
}

function statusForAbort(signal: AbortSignal): TerminalRunStatus | null {
  switch (abortReasonOf(signal)) {
    case 'cancelled':
      return 'cancelled';
    case 'time_limit':
      return 'timed_out';
    case 'lease_lost':
      return 'interrupted';
    default:
      return null;
  }
}
