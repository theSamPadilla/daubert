import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CaseActivityLogEntity,
  CaseActivitySource,
  CaseActivityStatus,
} from '../../database/entities/case-activity-log.entity';

/** Inputs larger than this (as JSON) are stored as a truncated preview. */
export const INPUT_CAP_CHARS = 16_384;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface RecordActivityParams {
  caseId: string;
  userId: string | null;
  source: CaseActivitySource;
  agent: string | null;
  conversationId?: string | null;
  mcpSessionId?: string | null;
  action: string;
  input: unknown;
  status: CaseActivityStatus;
  summary?: Record<string, unknown> | null;
}

export interface CaseActivityEntryDto {
  id: string;
  createdAt: string;
  source: CaseActivitySource;
  agent: string | null;
  action: string;
  input: unknown;
  status: CaseActivityStatus;
  summary: Record<string, unknown> | null;
  backfilled: boolean;
  conversationId: string | null;
  user: { id: string; name: string | null; email: string } | null;
}

export interface CaseActivityPageDto {
  items: CaseActivityEntryDto[];
  nextCursor: string | null;
}

export function capInput(input: unknown): unknown {
  const value = input ?? {};
  const json = JSON.stringify(value);
  if (json.length <= INPUT_CAP_CHARS) return value;
  return { _truncated: true, preview: json.slice(0, INPUT_CAP_CHARS) };
}

/** `<createdAt ISO>|<id>` of the last entry on the previous page. */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const sep = cursor.lastIndexOf('|');
  if (sep < 0) return null;
  const createdAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { createdAt, id };
}

function toDto(r: CaseActivityLogEntity, showUsers: boolean): CaseActivityEntryDto {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    source: r.source,
    agent: r.agent,
    action: r.action,
    input: r.input,
    status: r.status,
    summary: r.summary,
    backfilled: r.backfilled,
    conversationId: r.conversationId,
    user: showUsers && r.user ? { id: r.user.id, name: r.user.name ?? null, email: r.user.email } : null,
  };
}

@Injectable()
export class CaseActivityService {
  private readonly logger = new Logger(CaseActivityService.name);

  constructor(
    @InjectRepository(CaseActivityLogEntity)
    private readonly repo: Repository<CaseActivityLogEntity>,
  ) {}

  /** Never throws: a failed write is logged and the agent's work carries on. */
  async record(p: RecordActivityParams): Promise<void> {
    try {
      await this.repo.insert({
        caseId: p.caseId,
        userId: p.userId,
        source: p.source,
        agent: p.agent,
        conversationId: p.conversationId ?? null,
        mcpSessionId: p.mcpSessionId ?? null,
        action: p.action,
        input: capInput(p.input) as object,
        status: p.status,
        summary: (p.summary ?? null) as never,
      });
    } catch (err) {
      this.logger.error(
        `case_activity_log_write_failed caseId=${p.caseId} action=${p.action} source=${p.source}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Newest first, keyset-paged on (created_at, id). */
  async list(
    caseId: string,
    cursor: string | undefined,
    limit: number,
    showUsers: boolean,
  ): Promise<CaseActivityPageDto> {
    const take = Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
    const qb = this.repo.createQueryBuilder('a');
    if (showUsers) qb.leftJoinAndSelect('a.user', 'u');
    qb
      .where('a.caseId = :caseId', { caseId })
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .limit(take + 1);
    const after = cursor ? decodeCursor(cursor) : null;
    if (after) qb.andWhere('(a.createdAt, a.id) < (:ts, :id)', { ts: after.createdAt, id: after.id });
    const rows = await qb.getMany();
    const page = rows.slice(0, take);
    return {
      items: page.map((r) => toDto(r, showUsers)),
      nextCursor: rows.length > take ? encodeCursor(page[page.length - 1]) : null,
    };
  }
}
