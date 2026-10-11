import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { decodeCursor, encodeCursor } from '../../case-activity/case-activity.service';
import type {
  CaseActivitySource,
  CaseActivityStatus,
} from '../../../database/entities/case-activity-log.entity';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ToolCallFilters {
  orgId?: string;
  caseId?: string;
  conversationId?: string;
  userId?: string;
  action?: string;
  status?: CaseActivityStatus;
  from?: string;
  to?: string;
}

export interface ToolCallRow {
  id: string;
  createdAt: string;
  orgId: string | null;
  orgName: string | null;
  caseId: string;
  caseName: string | null;
  userId: string | null;
  userEmail: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  source: CaseActivitySource;
  agent: string | null;
  action: string;
  input: unknown;
  status: CaseActivityStatus;
  summary: Record<string, unknown> | null;
  backfilled: boolean;
}

export interface ToolCallPage {
  items: ToolCallRow[];
  nextCursor: string | null;
}

export interface ToolCallSummaryRow {
  action: string;
  status: CaseActivityStatus;
  count: number;
}

interface RawRow {
  id: string;
  created_at: Date;
  org_id: string | null;
  org_name: string | null;
  case_id: string;
  case_name: string | null;
  user_id: string | null;
  user_email: string | null;
  conversation_id: string | null;
  conversation_title: string | null;
  source: CaseActivitySource;
  agent: string | null;
  action: string;
  input: unknown;
  status: CaseActivityStatus;
  summary: Record<string, unknown> | null;
  backfilled: boolean;
}

@Injectable()
export class ToolCallsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Newest first, keyset-paged on (created_at, id). */
  async list(filters: ToolCallFilters, cursor: string | undefined, limit: number): Promise<ToolCallPage> {
    const take = Math.max(1, Math.min(limit, MAX_LIMIT));
    const { where, params } = this.buildWhere(filters);
    if (cursor) {
      const after = decodeCursor(cursor);
      if (!after) throw new BadRequestException('Invalid cursor');
      params.push(after.createdAt, after.id);
      where.push(`(a.created_at, a.id) < ($${params.length - 1}, $${params.length})`);
    }
    params.push(take + 1);
    const rows: RawRow[] = await this.dataSource.query(
      `SELECT a.id, a.created_at, c.organization_id AS org_id, o.name AS org_name,
              a.case_id, c.name AS case_name, a.user_id, u.email AS user_email,
              a.conversation_id, conv.title AS conversation_title,
              a.source, a.agent, a.action, a.input, a.status, a.summary, a.backfilled
         FROM case_activity_log a
         LEFT JOIN cases c ON c.id = a.case_id
         LEFT JOIN organizations o ON o.id = c.organization_id
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN conversations conv ON conv.id = a.conversation_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, take);
    return {
      items: page.map((r) => ({
        id: r.id,
        createdAt: r.created_at.toISOString(),
        orgId: r.org_id,
        orgName: r.org_name,
        caseId: r.case_id,
        caseName: r.case_name,
        userId: r.user_id,
        userEmail: r.user_email,
        conversationId: r.conversation_id,
        conversationTitle: r.conversation_title,
        source: r.source,
        agent: r.agent,
        action: r.action,
        input: r.input,
        status: r.status,
        summary: r.summary,
        backfilled: r.backfilled,
      })),
      nextCursor:
        rows.length > take
          ? encodeCursor({ createdAt: page[page.length - 1].created_at, id: page[page.length - 1].id })
          : null,
    };
  }

  /** Counts grouped by action and status for the same filters. */
  async summary(filters: ToolCallFilters): Promise<ToolCallSummaryRow[]> {
    const { where, params } = this.buildWhere(filters);
    const rows: Array<{ action: string; status: CaseActivityStatus; count: string }> =
      await this.dataSource.query(
        `SELECT a.action, a.status, COUNT(*)::text AS count
           FROM case_activity_log a
           LEFT JOIN cases c ON c.id = a.case_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          GROUP BY a.action, a.status
          ORDER BY COUNT(*) DESC, a.action, a.status`,
        params,
      );
    return rows.map((r) => ({ action: r.action, status: r.status, count: Number(r.count) }));
  }

  private buildWhere(f: ToolCallFilters): { where: string[]; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace('?', `$${params.length}`));
    };
    const uuid = (name: string, v: string | undefined, clause: string) => {
      if (!v) return;
      if (!UUID_RE.test(v)) throw new BadRequestException(`${name} must be a UUID`);
      add(clause, v);
    };
    uuid('orgId', f.orgId, 'c.organization_id = ?');
    uuid('caseId', f.caseId, 'a.case_id = ?');
    uuid('conversationId', f.conversationId, 'a.conversation_id = ?');
    uuid('userId', f.userId, 'a.user_id = ?');
    if (f.action) add('a.action = ?', f.action);
    if (f.status) {
      if (f.status !== 'ok' && f.status !== 'error') throw new BadRequestException('status must be ok or error');
      add('a.status = ?', f.status);
    }
    for (const [name, v, op] of [
      ['from', f.from, '>='],
      ['to', f.to, '<='],
    ] as const) {
      if (!v) continue;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} must be an ISO date`);
      add(`a.created_at ${op} ?`, d);
    }
    return { where, params };
  }
}
