import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  ACTIVE_RUN_INDEX,
  ACTIVE_RUN_STATUSES,
  AgentRunEntity,
  AgentRunStatus,
  RunError,
  TerminalRunStatus,
} from '../../../database/entities/agent-run.entity';
import { AgentRunEventEntity } from '../../../database/entities/agent-run-event.entity';
import { CaseRole } from '../../../database/entities/case-member.entity';
import { ConversationsService } from '../conversations.service';
import { RunEventRow } from './run-event-writer';

/** A running run whose heartbeat is older than this is considered dead. */
export const STALE_HEARTBEAT_SECONDS = 60;
/** A queued run Cloud Tasks never delivered within this window is abandoned. */
export const STALE_QUEUED_SECONDS = 300;

export const INTERRUPTED_MESSAGE =
  'This response was interrupted before it finished. Send another message to continue.';

export type HeartbeatState = 'ok' | 'cancel_requested' | 'lost';

export interface CreateRunInput {
  conversationId: string;
  userId: string;
  caseId: string | null;
  investigationId: string | null;
  model: string | null;
  viewerRole: CaseRole;
}

/**
 * Persistence and state transitions for agent runs. Every transition is a
 * conditional UPDATE on the current status, so concurrent actors (the
 * executor, a Cloud Tasks retry, the sweeper, a cancel) can't both win.
 */
@Injectable()
export class AgentRunsService {
  private readonly logger = new Logger(AgentRunsService.name);

  constructor(
    @InjectRepository(AgentRunEntity)
    private readonly runRepo: Repository<AgentRunEntity>,
    @InjectRepository(AgentRunEventEntity)
    private readonly eventRepo: Repository<AgentRunEventEntity>,
    private readonly conversationsService: ConversationsService,
  ) {}

  /**
   * Insert a queued run. Sweeps dead runs first so a crashed run never blocks
   * the conversation. Throws 409 (with the active run id) if a run is live.
   */
  async createQueued(input: CreateRunInput): Promise<AgentRunEntity> {
    await this.sweepStale(input.conversationId);
    let run: AgentRunEntity;
    try {
      run = await this.runRepo.save(this.runRepo.create({ ...input, status: 'queued' }));
    } catch (err) {
      if (!isActiveRunConflict(err)) throw err;
      const active = await this.findActive(input.conversationId);
      throw new ConflictException({
        message: 'A response is already in progress in this conversation.',
        activeRunId: active?.id ?? null,
      });
    }
    // Earlier runs' events are no longer needed: their messages are persisted.
    await this.eventRepo
      .createQueryBuilder()
      .delete()
      .where(
        'run_id IN (SELECT id FROM agent_runs WHERE conversation_id = :conversationId AND id <> :runId)',
        { conversationId: input.conversationId, runId: run.id },
      )
      .execute();
    return run;
  }

  async attachUserMessage(runId: string, userMessageId: string): Promise<void> {
    await this.runRepo.update({ id: runId }, { userMessageId });
  }

  /** Close a run that never started (launch rollback). */
  async failQueued(run: AgentRunEntity, error: RunError): Promise<void> {
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status: 'failed', error, finishedAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: run.id, status: 'queued' })
      .execute();
    if (res.affected) await this.appendTerminalEvents(run, 'failed', error.message);
  }

  /** queued -> running. Returns null if another delivery already claimed it. */
  async claim(runId: string): Promise<AgentRunEntity | null> {
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status: 'running', startedAt: () => 'now()', heartbeatAt: () => 'now()' })
      .where('id = :id AND status = :status AND user_message_id IS NOT NULL', {
        id: runId,
        status: 'queued',
      })
      .execute();
    if (!res.affected) return null;
    return this.runRepo.findOneByOrFail({ id: runId });
  }

  /** Renew the lease. 'lost' means the run is no longer running (swept or finished). */
  async heartbeat(runId: string): Promise<HeartbeatState> {
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ heartbeatAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: runId, status: 'running' })
      .returning('cancel_requested_at')
      .execute();
    if (!res.affected) return 'lost';
    return res.raw?.[0]?.cancel_requested_at ? 'cancel_requested' : 'ok';
  }

  /**
   * A queued run is cancelled on the spot (its task becomes a no-op). A running
   * run gets a flag the executor picks up on its next heartbeat.
   */
  async requestCancel(run: AgentRunEntity): Promise<void> {
    const queued = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status: 'cancelled', finishedAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: run.id, status: 'queued' })
      .execute();
    if (queued.affected) {
      await this.appendTerminalEvents(run, 'cancelled');
      return;
    }
    await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ cancelRequestedAt: () => 'now()' })
      .where('id = :id AND status = :status AND cancel_requested_at IS NULL', {
        id: run.id,
        status: 'running',
      })
      .execute();
  }

  async finish(runId: string, status: TerminalRunStatus, error: RunError | null): Promise<void> {
    await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({ status, error, finishedAt: () => 'now()' })
      .where('id = :id AND status = :status', { id: runId, status: 'running' })
      .execute();
  }

  /**
   * Mark this conversation's dead runs as interrupted: running with a stale
   * heartbeat, or queued and never delivered. Closes each with error + done
   * events and repairs a dangling tool_result tail. Called lazily (on start,
   * on open, and while a subscriber waits) instead of from a cron.
   */
  async sweepStale(conversationId: string): Promise<void> {
    const errorId = randomUUID();
    const res = await this.runRepo
      .createQueryBuilder()
      .update(AgentRunEntity)
      .set({
        status: 'interrupted',
        finishedAt: () => 'now()',
        error: { errorId, message: INTERRUPTED_MESSAGE },
      })
      .where(
        `conversation_id = :conversationId AND (
           (status = 'running' AND COALESCE(heartbeat_at, started_at) < now() - interval '${STALE_HEARTBEAT_SECONDS} seconds')
           OR (status = 'queued' AND created_at < now() - interval '${STALE_QUEUED_SECONDS} seconds')
         )`,
        { conversationId },
      )
      // Array form takes entity property paths; raw rows still come back snake_case.
      .returning(['id', 'conversationId'])
      .execute();
    const swept = (res.raw ?? []) as Array<{ id: string; conversation_id: string }>;
    if (swept.length === 0) return;

    for (const row of swept) {
      this.logger.warn(`run_interrupted runId=${row.id} conversationId=${row.conversation_id} errorId=${errorId}`);
      try {
        await this.appendTerminalEvents(
          { id: row.id, conversationId: row.conversation_id },
          'interrupted',
          INTERRUPTED_MESSAGE,
        );
      } catch (err) {
        // A zombie executor may have raced us for the next seq. The run is
        // already terminal; streamers fall back to a synthetic done.
        this.logger.warn(`run_interrupted_events_failed runId=${row.id}: ${String(err)}`);
      }
    }
    await this.conversationsService.appendTerminatorIfToolResultTail(conversationId);
  }

  findActive(conversationId: string): Promise<AgentRunEntity | null> {
    return this.runRepo.findOne({ where: { conversationId, status: In(ACTIVE_RUN_STATUSES) } });
  }

  findLatest(conversationId: string): Promise<AgentRunEntity | null> {
    return this.runRepo.findOne({ where: { conversationId }, order: { createdAt: 'DESC' } });
  }

  findForConversation(runId: string, conversationId: string): Promise<AgentRunEntity | null> {
    return this.runRepo.findOne({ where: { id: runId, conversationId } });
  }

  async getStatus(runId: string): Promise<AgentRunStatus | null> {
    const run = await this.runRepo.findOne({ where: { id: runId }, select: ['id', 'status'] });
    return run?.status ?? null;
  }

  async appendEvents(runId: string, rows: RunEventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.eventRepo.insert(rows.map((r) => ({ runId, seq: r.seq, type: r.type, data: r.data as object })));
  }

  listEventsAfter(runId: string, after: number, limit = 500): Promise<AgentRunEventEntity[]> {
    return this.eventRepo.find({
      where: { runId, seq: MoreThan(after) },
      order: { seq: 'ASC' },
      take: limit,
    });
  }

  private async appendTerminalEvents(
    run: { id: string; conversationId: string },
    status: TerminalRunStatus,
    errorMessage?: string,
  ): Promise<void> {
    const raw = await this.eventRepo
      .createQueryBuilder('e')
      .select('COALESCE(MAX(e.seq), 0)', 'max')
      .where('e.run_id = :runId', { runId: run.id })
      .getRawOne<{ max: number | string }>();
    let seq = Number(raw?.max ?? 0);
    const rows: RunEventRow[] = [];
    if (errorMessage) rows.push({ seq: ++seq, type: 'error', data: { message: errorMessage } });
    rows.push({ seq: ++seq, type: 'done', data: { conversationId: run.conversationId, status } });
    await this.appendEvents(run.id, rows);
  }
}

function isActiveRunConflict(err: unknown): boolean {
  const driver = (err as { driverError?: { code?: string; constraint?: string } })?.driverError;
  return err instanceof QueryFailedError && driver?.code === '23505' && driver?.constraint === ACTIVE_RUN_INDEX;
}
