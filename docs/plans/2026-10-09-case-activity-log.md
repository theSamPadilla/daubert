# Case Activity Log Implementation Plan

**Goal:** a durable, append-only record of every action an AI agent takes on a case, kept with the case and outside the 30-day chat purge.

## Summary
- **What & why:** Chat messages are deleted after 30 days, and agent tool calls lived only inside them, so the record of how the agent reached its conclusions disappears. This adds a `case_activity_log` table written by both the in-app chat agent and MCP agents, a read endpoint, and an Activity page in the case workspace. Design: `docs/plans/2026-10-09-case-activity-log-design.md`.
- **Key product decisions:** covers both chat and MCP agents in one log per case; each entry stores inputs, outcome and a short summary, never full results; every case member can read it; nobody can edit or delete entries; they go only when the case is deleted. Existing chat history from the last 30 days is backfilled.
- **Load-bearing architecture decisions:** a failed log write never fails the agent's work (it is logged as `case_activity_log_write_failed`); MCP recording wraps tool registration in one place and records only when the caller can access the case, so a denied call cannot write into another team's log; paging is keyset on `(created_at, id)` with millisecond timestamps.
- **Opus-tagged tasks:** 5 (chat hook in `AiService`), 6 (MCP recording wrapper), 7 (migration with backfill).

---
> **For Claude:** REQUIRED SUB-SKILL: Use the execute skill (/execute) to implement this plan task-by-task.

## Rules for every implementer

- Do NOT commit. Do NOT add a Co-Authored-By trailer anywhere. End each task with `git status`.
- Run only the spec files named in the task: `npx jest <path>` from `backend/` or `frontend/`. Never `npm test`, never directory sweeps, never boot the app.
- Type-check with `npx tsc --noEmit` (in `backend/` or `frontend/`) only when the task says so.
- No em dashes or en dashes in user-facing copy. No emojis; icons come from `react-icons/fa6`.
- Never run `./migrations.sh --prod --run` or any write against production.

## Atomized Changes

| Task | File | Action | Purpose |
|------|------|--------|---------|
| 1 | `backend/src/database/entities/case-activity-log.entity.ts` | Create | Append-only `case_activity_log` table, kept for the life of the case |
| 1 | `backend/src/database/entities/index.ts` | Modify | Register the entity |
| 1 | `docs/data-model.md` | Modify | Document the table |
| 2 | `backend/src/modules/case-activity/case-activity.service.ts` | Create | `record()` that never throws; `list()` with keyset paging; input capping |
| 2 | `backend/src/modules/case-activity/case-activity.controller.ts` | Create | Case members can read `GET /cases/:caseId/activity` |
| 2 | `backend/src/modules/case-activity/case-activity.module.ts` | Create | Exports the service to the AI and MCP modules |
| 2 | `backend/src/modules/case-activity/case-activity.service.spec.ts` | Create | Tests for record, list and cursors |
| 2 | `backend/src/app.module.ts` | Modify | Import `CaseActivityModule` |
| 3 | `backend/src/modules/case-activity/activity-summaries.ts` | Create | Turns tool results into short, content-light summaries (chat, web search, MCP) |
| 3 | `backend/src/modules/case-activity/activity-summaries.spec.ts` | Create | Tests for the summarizers |
| 4 | `contracts/paths/case-activity.yaml`, `contracts/schemas/case-activity.yaml` | Create | API contract for the read endpoint |
| 4 | `contracts/openapi.yaml` | Modify | Register the path and schemas |
| 4 | `backend/src/generated/api-types.ts`, `frontend/src/generated/api-types.ts` | Modify (generated) | Types from the contract |
| 4 | `frontend/src/lib/api-client.ts` | Modify | `listCaseActivity()` |
| 5 | `backend/src/modules/ai/ai.service.ts` | Modify | Every chat tool call and server-side web search is recorded |
| 5 | `backend/src/modules/ai/ai.module.ts` | Modify | Import `CaseActivityModule` |
| 5 | `backend/src/modules/ai/ai.service.spec.ts` | Modify | Provide the new dependency in all five modules; tests for chat recording |
| 6 | `backend/src/modules/mcp/tools/case-activity-recorder.ts` | Create | Wraps MCP tool registration so case-scoped tools are recorded |
| 6 | `backend/src/modules/mcp/tools/case-activity-recorder.spec.ts` | Create | Recorder tests |
| 6 | `backend/src/modules/mcp/mcp.tools.ts`, `backend/src/modules/mcp/mcp.module.ts` | Modify | Route registration through the recorder |
| 6 | `backend/src/modules/mcp/mcp.tools.spec.ts` | Modify | Fifth constructor argument; test that every MCP tool is classified |
| 7 | `backend/src/database/migrations/<ts>-AddCaseActivityLog.ts` | Create (generated + backfill) | Prod schema plus backfill from surviving chat messages |
| 8 | `frontend/src/components/Workspace/activityFormat.ts` (+ `.test.ts`) | Create | Human labels, key input and source label per entry |
| 9 | `frontend/src/app/cases/[caseId]/(workspace)/activity/page.tsx` (+ `page.spec.tsx`) | Create | The Activity page |
| 9 | `frontend/src/components/Workspace/InvestigationsSidebar.tsx` | Modify | "Activity" entry under Data Room |
| 10 | `docs/chat-retention.md` | Modify | The purge does not touch the activity log |

---

## Task 1: Entity

**Implementer:** sonnet
**Files:** Create `backend/src/database/entities/case-activity-log.entity.ts`; Modify `backend/src/database/entities/index.ts`, `docs/data-model.md`.

**Step 1: Create the entity.** It does not extend `BaseEntity`: the log has no `updated_at`, and `created_at` is `timestamptz(3)` so JavaScript `Date` round-trips exactly for the paging cursor.

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CaseEntity } from './case.entity';
import { UserEntity } from './user.entity';

export type CaseActivitySource = 'chat' | 'mcp';
export type CaseActivityStatus = 'ok' | 'error';

/**
 * Append-only record of what an AI agent did on a case: the in-app chat agent
 * or an external agent over MCP. Kept for the life of the case and not touched
 * by chat retention (docs/chat-retention.md). Nothing in the codebase updates
 * or deletes rows; they go when their case is deleted.
 */
@Entity('case_activity_log')
@Index('ix_case_activity_log_case_created', ['caseId', 'createdAt', 'id'])
export class CaseActivityLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Millisecond precision so a JS Date round-trips exactly in the paging cursor.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt: Date;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @ManyToOne(() => CaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  /** The person the agent acted for. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @Column({ type: 'varchar', length: 16 })
  source: CaseActivitySource;

  /** Chat: the model that answered. MCP: the session's surface label, e.g. "Claude Desktop". */
  @Column({ type: 'varchar', length: 255, nullable: true })
  agent: string | null;

  /** Plain column, no FK: chats are purged after 30 days, the id still groups a session. */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  /** Plain column matching agent_audit_log.session_id. */
  @Column({ name: 'mcp_session_id', type: 'uuid', nullable: true })
  mcpSessionId: string | null;

  /** Tool name. */
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'jsonb' })
  input: unknown;

  @Column({ type: 'varchar', length: 16 })
  status: CaseActivityStatus;

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  /** Rebuilt from chat messages by the AddCaseActivityLog migration. */
  @Column({ type: 'boolean', default: false })
  backfilled: boolean;
}
```

**Step 2: Register it.** In `backend/src/database/entities/index.ts`, add `import { CaseActivityLogEntity } from './case-activity-log.entity';` with the other imports and add `CaseActivityLogEntity` to the `entities` array in alphabetical position (before `CaseEntity`).

**Step 3: Document it.** In `docs/data-model.md`, add a `### case_activity_log` section after the `messages` section, in the same table style as its neighbours, listing every column above, the `(case_id, created_at, id)` index, the FKs (`case_id` CASCADE, `user_id` SET NULL), and one line: "Append-only. Not touched by the chat retention purge; rows go with their case."

**Step 4: Verify.** From `backend/`: `npx tsc --noEmit` passes. Run `git status`.

---

## Task 2: Service, controller, module

**Implementer:** sonnet
**Files:** Create `backend/src/modules/case-activity/case-activity.service.ts`, `case-activity.controller.ts`, `case-activity.module.ts`, `case-activity.service.spec.ts`; Modify `backend/src/app.module.ts`.

**Step 1: Write the failing spec** `backend/src/modules/case-activity/case-activity.service.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import {
  CaseActivityService,
  INPUT_CAP_CHARS,
  capInput,
  decodeCursor,
  encodeCursor,
} from './case-activity.service';

function qbMock(rows: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'limit']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn().mockResolvedValue(rows);
  return qb;
}

function row(i: number) {
  return {
    id: `00000000-0000-0000-0000-00000000000${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 9, 12, 0, i)),
    caseId: 'case-1',
    userId: 'user-1',
    user: { id: 'user-1', name: 'Ana', email: 'ana@firm.com' },
    source: 'chat',
    agent: 'claude-opus-5',
    conversationId: 'conv-1',
    mcpSessionId: null,
    action: 'get_case_data',
    input: {},
    status: 'ok',
    summary: null,
    backfilled: false,
  };
}

let repo: { insert: jest.Mock; createQueryBuilder: jest.Mock };
let service: CaseActivityService;

beforeEach(() => {
  repo = { insert: jest.fn().mockResolvedValue(undefined), createQueryBuilder: jest.fn() };
  service = new CaseActivityService(repo as any);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('capInput', () => {
  it('keeps small inputs as they are', () => {
    expect(capInput({ query: 'x' })).toEqual({ query: 'x' });
    expect(capInput(undefined)).toEqual({});
  });

  it('replaces oversized inputs with a truncated preview', () => {
    const capped = capInput({ code: 'a'.repeat(INPUT_CAP_CHARS * 2) }) as { _truncated: boolean; preview: string };
    expect(capped._truncated).toBe(true);
    expect(capped.preview).toHaveLength(INPUT_CAP_CHARS);
  });
});

describe('cursor', () => {
  it('round-trips createdAt and id', () => {
    const r = row(3);
    expect(decodeCursor(encodeCursor(r))).toEqual({ createdAt: r.createdAt, id: r.id });
  });

  it('rejects malformed cursors', () => {
    expect(decodeCursor('nope')).toBeNull();
    expect(decodeCursor('not-a-date|00000000-0000-0000-0000-000000000001')).toBeNull();
    expect(decodeCursor('2026-10-09T12:00:00.000Z|not-a-uuid')).toBeNull();
  });
});

describe('CaseActivityService.record', () => {
  it('inserts the entry with a capped input', async () => {
    await service.record({
      caseId: 'case-1', userId: 'user-1', source: 'mcp', agent: 'Claude Desktop',
      mcpSessionId: 'sess-1', action: 'get_case_data', input: { caseId: 'case-1' }, status: 'ok',
    });
    expect(repo.insert).toHaveBeenCalledWith({
      caseId: 'case-1', userId: 'user-1', source: 'mcp', agent: 'Claude Desktop',
      conversationId: null, mcpSessionId: 'sess-1', action: 'get_case_data',
      input: { caseId: 'case-1' }, status: 'ok', summary: null,
    });
  });

  it('never throws when the insert fails', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.record({ caseId: 'case-1', userId: null, source: 'chat', agent: null, action: 'x', input: {}, status: 'ok' }),
    ).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('case_activity_log_write_failed'));
  });
});

describe('CaseActivityService.list', () => {
  it('returns a page and a cursor when more rows exist', async () => {
    const qb = qbMock([row(3), row(2), row(1)]);
    repo.createQueryBuilder.mockReturnValue(qb);

    const page = await service.list('case-1', undefined, 2);

    expect(qb.limit).toHaveBeenCalledWith(3);
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(page.items.map((i) => i.id)).toEqual([row(3).id, row(2).id]);
    expect(page.items[0]).toMatchObject({
      createdAt: row(3).createdAt.toISOString(),
      user: { id: 'user-1', name: 'Ana', email: 'ana@firm.com' },
    });
    expect(page.nextCursor).toBe(encodeCursor(row(2)));
  });

  it('applies the cursor and returns no cursor on the last page', async () => {
    const qb = qbMock([row(1)]);
    repo.createQueryBuilder.mockReturnValue(qb);

    const page = await service.list('case-1', encodeCursor(row(2)), 2);

    expect(qb.andWhere).toHaveBeenCalledWith('(a.createdAt, a.id) < (:ts, :id)', {
      ts: row(2).createdAt,
      id: row(2).id,
    });
    expect(page.nextCursor).toBeNull();
  });
});
```

**Step 2:** From `backend/`: `npx jest src/modules/case-activity/case-activity.service.spec.ts`. Expect failure: cannot find module `./case-activity.service`.

**Step 3: Implement** `backend/src/modules/case-activity/case-activity.service.ts`:

```ts
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

function toDto(r: CaseActivityLogEntity): CaseActivityEntryDto {
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
    user: r.user ? { id: r.user.id, name: r.user.name ?? null, email: r.user.email } : null,
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
        summary: p.summary ?? null,
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
  async list(caseId: string, cursor: string | undefined, limit: number): Promise<CaseActivityPageDto> {
    const take = Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.user', 'u')
      .where('a.caseId = :caseId', { caseId })
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .limit(take + 1);
    const after = cursor ? decodeCursor(cursor) : null;
    if (after) qb.andWhere('(a.createdAt, a.id) < (:ts, :id)', { ts: after.createdAt, id: after.id });
    const rows = await qb.getMany();
    const page = rows.slice(0, take);
    return {
      items: page.map(toDto),
      nextCursor: rows.length > take ? encodeCursor(page[page.length - 1]) : null,
    };
  }
}
```

If `repo.insert` rejects the `input` type, cast through `as never`, not `any`.

**Step 4: Controller** `backend/src/modules/case-activity/case-activity.controller.ts`:

```ts
import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequireRole } from '../auth/require-role.decorator';
import { CaseActivityPageDto, CaseActivityService, DEFAULT_PAGE_SIZE } from './case-activity.service';

@Controller()
export class CaseActivityController {
  constructor(private readonly activity: CaseActivityService) {}

  @RequireRole('viewer')
  @Get('cases/:caseId/activity')
  list(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = DEFAULT_PAGE_SIZE,
  ): Promise<CaseActivityPageDto> {
    return this.activity.list(caseId, cursor, limit);
  }
}
```

**Step 5: Module** `backend/src/modules/case-activity/case-activity.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseActivityLogEntity } from '../../database/entities/case-activity-log.entity';
import { AuthModule } from '../auth/auth.module';
import { CaseActivityController } from './case-activity.controller';
import { CaseActivityService } from './case-activity.service';

@Module({
  imports: [TypeOrmModule.forFeature([CaseActivityLogEntity]), AuthModule],
  controllers: [CaseActivityController],
  providers: [CaseActivityService],
  exports: [CaseActivityService],
})
export class CaseActivityModule {}
```

Add `CaseActivityModule` to `imports` in `backend/src/app.module.ts` after `DataRoomModule`.

**Step 6:** `npx jest src/modules/case-activity/case-activity.service.spec.ts` passes; `npx tsc --noEmit` passes. Run `git status`.

---

## Task 3: Result summarizers

**Implementer:** sonnet
**Files:** Create `backend/src/modules/case-activity/activity-summaries.ts`, `activity-summaries.spec.ts`.

**Step 1: Write the failing spec** `activity-summaries.spec.ts`:

```ts
import {
  chatToolOutcome,
  mcpToolOutcome,
  summarizeValue,
  thrownOutcome,
  webSearchActivities,
} from './activity-summaries';

describe('summarizeValue', () => {
  it('keeps scalars, counts arrays, drops nested objects and internal keys', () => {
    expect(
      summarizeValue({ id: 'p1', status: 'success', rows: [1, 2, 3], data: { big: true }, __internal: 'x', ok: true }),
    ).toEqual({ id: 'p1', status: 'success', rowsCount: 3, ok: true });
  });

  it('clips long strings to 200 characters', () => {
    const s = summarizeValue({ output: 'a'.repeat(500) }) as { output: string };
    expect(s.output).toHaveLength(203);
    expect(s.output.endsWith('...')).toBe(true);
  });

  it('counts top-level arrays and returns null for empty objects', () => {
    expect(summarizeValue([1, 2])).toEqual({ count: 2 });
    expect(summarizeValue({ nested: { a: 1 } })).toBeNull();
    expect(summarizeValue(undefined)).toBeNull();
  });
});

describe('chatToolOutcome', () => {
  it('treats an { error } result as a failure', () => {
    expect(chatToolOutcome('get_case_data', {}, { error: 'No case context.' })).toEqual({
      status: 'error',
      summary: { error: 'No case context.' },
    });
  });

  it('summarizes a data room read by file id, not content', () => {
    expect(chatToolOutcome('read_data_room_file', { fileId: 'f1' }, { __agentReadBlocks: [{ type: 'document' }] })).toEqual({
      status: 'ok',
      summary: { fileId: 'f1' },
    });
  });

  it('summarizes other results generically', () => {
    expect(chatToolOutcome('execute_script', {}, { scriptRunId: 'r1', status: 'success' })).toEqual({
      status: 'ok',
      summary: { scriptRunId: 'r1', status: 'success' },
    });
  });

  it('treats a script that errored or timed out as a failure', () => {
    expect(chatToolOutcome('execute_script', {}, { status: 'error', output: 'TypeError: x' })).toEqual({
      status: 'error',
      summary: { status: 'error', output: 'TypeError: x' },
    });
    expect(chatToolOutcome('execute_script', {}, { status: 'timeout' }).status).toBe('error');
  });
});

describe('thrownOutcome', () => {
  it('records the error message', () => {
    expect(thrownOutcome(new Error('boom'))).toEqual({ status: 'error', summary: { error: 'boom' } });
  });
});

describe('webSearchActivities', () => {
  it('pairs each web search with its sources', () => {
    const out = webSearchActivities([
      { type: 'text', text: 'Looking' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'tornado cash' } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's1',
        content: [{ type: 'web_search_result', title: 'OFAC', url: 'https://example.gov/a' }],
      },
    ]);
    expect(out).toEqual([
      {
        input: { query: 'tornado cash' },
        outcome: { status: 'ok', summary: { sources: [{ title: 'OFAC', url: 'https://example.gov/a' }] } },
      },
    ]);
  });

  it('marks a search error', () => {
    const out = webSearchActivities([
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
    ]);
    expect(out[0].outcome).toEqual({ status: 'error', summary: { error: 'max_uses_exceeded' } });
  });

  it('ignores other server tools', () => {
    expect(webSearchActivities([{ type: 'server_tool_use', id: 'c1', name: 'code_execution', input: {} }])).toEqual([]);
  });
});

describe('mcpToolOutcome', () => {
  it('reads error envelopes', () => {
    expect(mcpToolOutcome({ isError: true, content: [{ type: 'text', text: 'Forbidden' }] })).toEqual({
      status: 'error',
      summary: { error: 'Forbidden' },
    });
  });

  it('summarizes JSON text results', () => {
    expect(mcpToolOutcome({ content: [{ type: 'text', text: '{"id":"inv1","traces":[1,2]}' }] })).toEqual({
      status: 'ok',
      summary: { id: 'inv1', tracesCount: 2 },
    });
  });

  it('falls back to sizes for non-JSON content', () => {
    expect(mcpToolOutcome({ content: [{ type: 'text', text: 'not json' }] })).toEqual({
      status: 'ok',
      summary: { textLength: 8 },
    });
    expect(mcpToolOutcome({ content: [{ type: 'resource' }, { type: 'image' }] })).toEqual({
      status: 'ok',
      summary: { blocks: 2 },
    });
  });
});
```

**Step 2:** `npx jest src/modules/case-activity/activity-summaries.spec.ts` fails (module not found).

**Step 3: Implement** `activity-summaries.ts`:

```ts
import type { CaseActivityStatus } from '../../database/entities/case-activity-log.entity';

const MAX_STRING = 200;
const MAX_ERROR = 500;
const MAX_KEYS = 12;
const MAX_SOURCES = 20;

export interface ActivityOutcome {
  status: CaseActivityStatus;
  summary: Record<string, unknown> | null;
}

type Block = { type: string; [key: string]: unknown };

function clip(s: string, max = MAX_STRING): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/**
 * A short, content-light description of a result: top-level scalars (strings
 * clipped) and array sizes. Full results live in the case already or are
 * public chain data; the log keeps what happened, not a copy.
 */
export function summarizeValue(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return { count: value.length };
  if (!value || typeof value !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (key.startsWith('__')) continue;
    if (typeof v === 'string') out[key] = clip(v);
    else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (Array.isArray(v)) out[`${key}Count`] = v.length;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Chat tools report failure in a normal result: `{ error: string }`, or for
 * execute_script a `status` of 'error' or 'timeout' (ScriptExecutionService).
 */
export function chatToolOutcome(action: string, input: unknown, result: unknown): ActivityOutcome {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.error === 'string') return { status: 'error', summary: { error: clip(r.error, MAX_ERROR) } };
    if (action === 'execute_script' && (r.status === 'error' || r.status === 'timeout')) {
      return { status: 'error', summary: summarizeValue(result) };
    }
    if ('__agentReadBlocks' in r) {
      const fileId = (input as { fileId?: unknown } | null)?.fileId;
      return { status: 'ok', summary: typeof fileId === 'string' ? { fileId } : null };
    }
  }
  return { status: 'ok', summary: summarizeValue(result) };
}

export function thrownOutcome(err: unknown): ActivityOutcome {
  const message = err instanceof Error ? err.message : String(err);
  return { status: 'error', summary: { error: clip(message, MAX_ERROR) } };
}

/** Server-side web searches never reach executeTool; pair each call with its result block. */
export function webSearchActivities(
  content: ReadonlyArray<Block>,
): Array<{ input: { query: string | null }; outcome: ActivityOutcome }> {
  const results = new Map<string, unknown>();
  for (const b of content) {
    if (b.type === 'web_search_tool_result' && typeof b.tool_use_id === 'string') results.set(b.tool_use_id, b.content);
  }
  return content
    .filter((b) => b.type === 'server_tool_use' && b.name === 'web_search' && typeof b.id === 'string')
    .map((b) => {
      const rawQuery = (b.input as { query?: unknown } | undefined)?.query;
      const input = { query: typeof rawQuery === 'string' ? rawQuery : null };
      const res = results.get(b.id as string);
      if (Array.isArray(res)) {
        const sources = (res as Block[])
          .filter((r) => r.type === 'web_search_result')
          .slice(0, MAX_SOURCES)
          .map((r) => ({ title: clip(String(r.title ?? '')), url: String(r.url ?? '') }));
        return { input, outcome: { status: 'ok' as const, summary: { sources } } };
      }
      const errorCode = (res as { error_code?: unknown } | undefined)?.error_code;
      if (typeof errorCode === 'string') return { input, outcome: { status: 'error' as const, summary: { error: errorCode } } };
      return { input, outcome: { status: 'ok' as const, summary: null } };
    });
}

/** MCP handlers return `{ content: [...], isError? }` envelopes. */
export function mcpToolOutcome(result: unknown): ActivityOutcome {
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> } | undefined;
  const text = r?.content?.find((c) => c.type === 'text')?.text;
  if (r?.isError) return { status: 'error', summary: { error: clip(text ?? 'Tool error', MAX_ERROR) } };
  if (typeof text === 'string') {
    try {
      return { status: 'ok', summary: summarizeValue(JSON.parse(text)) };
    } catch {
      return { status: 'ok', summary: { textLength: text.length } };
    }
  }
  return { status: 'ok', summary: r?.content ? { blocks: r.content.length } : null };
}
```

**Step 4:** The spec passes. Run `git status`.

---

## Task 4: Contract, generated types, API client

**Implementer:** sonnet
**Files:** Create `contracts/paths/case-activity.yaml`, `contracts/schemas/case-activity.yaml`; Modify `contracts/openapi.yaml`, `frontend/src/lib/api-client.ts`; regenerate both `api-types.ts`.

**Step 1:** `contracts/schemas/case-activity.yaml`:

```yaml
CaseActivityEntry:
  type: object
  required: [id, createdAt, source, agent, action, input, status, summary, backfilled, conversationId, user]
  properties:
    id:
      type: string
      format: uuid
    createdAt:
      type: string
      format: date-time
    source:
      type: string
      enum: [chat, mcp]
    agent:
      type: string
      nullable: true
      description: Chat entries name the model; MCP entries name the connected surface, e.g. "Claude Desktop".
    action:
      type: string
      description: Tool name, e.g. get_case_data or web_search.
    input:
      description: Tool input as the agent sent it. Inputs over 16 KB are replaced by { _truncated, preview }.
    status:
      type: string
      enum: [ok, error]
    summary:
      type: object
      nullable: true
      additionalProperties: true
    backfilled:
      type: boolean
    conversationId:
      type: string
      format: uuid
      nullable: true
    user:
      type: object
      nullable: true
      required: [id, name, email]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
          nullable: true
        email:
          type: string

CaseActivityPage:
  type: object
  required: [items, nextCursor]
  properties:
    items:
      type: array
      items:
        $ref: '#/CaseActivityEntry'
    nextCursor:
      type: string
      nullable: true
```

**Step 2:** `contracts/paths/case-activity.yaml`, following `contracts/paths/productions.yaml`:

```yaml
/cases/{caseId}/activity:
  get:
    summary: List what AI agents did on a case, newest first
    description: Append-only. Covers the in-app chat agent and MCP agents. Any case member may read it.
    operationId: listCaseActivity
    parameters:
      - name: caseId
        in: path
        required: true
        schema:
          type: string
          format: uuid
      - name: cursor
        in: query
        required: false
        description: nextCursor from the previous page
        schema:
          type: string
      - name: limit
        in: query
        required: false
        schema:
          type: integer
          default: 50
          maximum: 200
    responses:
      '200':
        description: One page of entries
        content:
          application/json:
            schema:
              $ref: '../schemas/case-activity.yaml#/CaseActivityPage'
      '403':
        description: Not a member of the case
        content:
          application/json:
            schema:
              $ref: '../schemas/common.yaml#/ErrorResponse'
```

**Step 3:** In `contracts/openapi.yaml`, register the path next to the other `/cases/{caseId}/...` paths:

```yaml
  /cases/{caseId}/activity:
    $ref: './paths/case-activity.yaml#/~1cases~1{caseId}~1activity'
```

and under `components.schemas`:

```yaml
    CaseActivityEntry:
      $ref: './schemas/case-activity.yaml#/CaseActivityEntry'
    CaseActivityPage:
      $ref: './schemas/case-activity.yaml#/CaseActivityPage'
```

**Step 4:** From the repo root: `npm run gen`. Confirm `CaseActivityPage` appears in both `frontend/src/generated/api-types.ts` and `backend/src/generated/api-types.ts`, and `git diff --stat` shows no other generated changes.

**Step 5:** In `frontend/src/lib/api-client.ts`, next to `listProductions`:

```ts
  listCaseActivity: (caseId: string, cursor?: string | null, limit = 50) =>
    request<components['schemas']['CaseActivityPage']>(
      `/cases/${caseId}/activity?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
```

(`components` is already imported there; if not, import `type { components } from '../generated/api-types'` the way the superadmin methods do.)

**Step 6:** From `frontend/`: `npx tsc --noEmit` passes. Run `git status`.

---

## Task 5: Record chat tool calls and web searches

**Implementer:** opus
**Files:** Modify `backend/src/modules/ai/ai.service.ts`, `backend/src/modules/ai/ai.module.ts`, `backend/src/modules/ai/ai.service.spec.ts`.

Context (verified 2026-10-09):
- `runTurn` (~line 409) destructures `conversationId, userId, ..., caseId, ...`; `resolvedCaseId` is at ~line 419.
- `responseContent` is at ~588 and keeps `server_tool_use` / `web_search_tool_result` blocks; the comment above it ("Provider already stripped server-side and thinking blocks") is wrong. The provider strips only thinking blocks.
- The early return for `end_turn` / no client tools comes right after, so web searches must be recorded before it.
- The client tool loop is at ~660-705, calling `this.executeTool(...)` at ~667. Tools signal failure with an `{ error }` result; nothing sets `is_error`. A throw escapes `runTurn`.
- The model that answered is `response.model`.

**Step 1: Write failing tests** in `ai.service.spec.ts`:
- Add `const mockCaseActivity = { record: jest.fn().mockResolvedValue(undefined) };` with the other mocks, and add `{ provide: CaseActivityService, useValue: mockCaseActivity }` to **all five** `Test.createTestingModule` providers lists in the file (lines ~76, ~441, ~544, ~718, ~814: executeTool label cases, `pickToolsForRole`, token usage metering, prompt cache breakpoints, runTurn lifecycle). The `pickToolsForRole` module at ~441 uses inline `useValue` mocks; add the same provider there. Import `CaseActivityService` from `'../case-activity/case-activity.service'`.
- In the describe holding the loop test (~line 719), add three tests modelled exactly on that test's setup: the same `mockConversationRepo.findOne` value (`caseId: CASE_ID`), the same `streamChat` async-generator mocking and `makeResponse` helper, and draining `aiService.runTurn({...})`:
  1. `records each client tool call to the case activity log`: first response has one `tool_use` (`list_script_runs`, input `{}`), second is `end_turn`. Expect `mockCaseActivity.record` called with `expect.objectContaining({ caseId: CASE_ID, userId: 'user-1', source: 'chat', conversationId: 'conv-1', action: 'list_script_runs', input: {}, status: 'ok' })`, and `agent: 'claude-opus-5'` (`makeResponse`, local to the "prompt cache breakpoints" describe at ~line 681, already sets that model).
  2. `records a tool that returns { error } as a failure`: call `runTurn` with `caseId: undefined` while `mockConversationRepo.findOne` still returns `{ id: 'conv-1', caseId: CASE_ID, case: { orgId: 'org-1' } }`, and have the first response call `get_case_data` (input `{}`). `executeTool` returns `{ error: 'No case context...' }` (ai.service.ts ~788) because the request had no caseId, while `activityCaseId` still resolves from the conversation. Expect `record` called with `expect.objectContaining({ caseId: CASE_ID, action: 'get_case_data', status: 'error', summary: { error: expect.stringContaining('No case context') } })`.
  3. `records server-side web searches from the response`: an `end_turn` response whose content is `[{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'mixer' } }, { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', title: 'T', url: 'https://u' }] }, { type: 'text', text: 'done' }]`. Expect `record` called with `expect.objectContaining({ action: 'web_search', input: { query: 'mixer' }, status: 'ok', summary: { sources: [{ title: 'T', url: 'https://u' }] } })`.

**Step 2:** `npx jest src/modules/ai/ai.service.spec.ts` fails: the new tests fail (record not called). Existing tests should still pass. If they fail only because of the new provider, fix the provider lists first.

**Step 3: Implement.**
- `ai.module.ts`: add `CaseActivityModule` to `imports`.
- `ai.service.ts` constructor: add `private readonly caseActivity: CaseActivityService,` after `addressClassificationsService` (before the `@InjectRepository` params).
- Import `chatToolOutcome, thrownOutcome, webSearchActivities, ActivityOutcome` from `'../case-activity/activity-summaries'`.
- Right after `resolvedCaseId` / `resolvedOrgId`:

```ts
    // The conversation's case is authoritative; the request's caseId is a fallback.
    const activityCaseId = resolvedCaseId ?? caseId ?? null;
```

- Fix the stale comment above `responseContent` to: `// Provider stripped thinking blocks; server tool blocks (web_search) remain.` Then, immediately after `responseContent` is assigned and before the `toolUseBlocks` early return:

```ts
        if (activityCaseId) {
          for (const search of webSearchActivities(responseContent as unknown as Array<{ type: string; [k: string]: unknown }>)) {
            await this.caseActivity.record({
              caseId: activityCaseId,
              userId,
              source: 'chat',
              agent: response.model,
              conversationId,
              action: 'web_search',
              input: search.input,
              status: search.outcome.status,
              summary: search.outcome.summary,
            });
          }
        }
```

- Replace the `executeTool` call in the loop:

```ts
          let result: unknown;
          try {
            result = await this.executeTool(toolUse, caseId, investigationId, viewerRole, userId);
          } catch (err) {
            await this.recordChatActivity(activityCaseId, userId, response.model, conversationId, toolUse, thrownOutcome(err));
            throw err;
          }
          await this.recordChatActivity(
            activityCaseId, userId, response.model, conversationId, toolUse,
            chatToolOutcome(toolUse.name, toolUse.input, result),
          );
```

- Add the private helper near `executeTool`:

```ts
  /** One entry per client tool call; the log outlives the chat (see CaseActivityService). */
  private async recordChatActivity(
    caseId: string | null,
    userId: string,
    agent: string,
    conversationId: string,
    toolUse: Anthropic.ToolUseBlock,
    outcome: ActivityOutcome,
  ): Promise<void> {
    if (!caseId) return;
    await this.caseActivity.record({
      caseId,
      userId,
      source: 'chat',
      agent,
      conversationId,
      action: toolUse.name,
      input: toolUse.input,
      status: outcome.status,
      summary: outcome.summary,
    });
  }
```

Match the actual variable names in the file if any differ (`response`, `toolUse`). Do not change any other behavior of the loop.

**Step 4:** `npx jest src/modules/ai/ai.service.spec.ts` passes in full; `npx tsc --noEmit` passes. Run `git status`.

---

## Task 6: Record MCP tool calls

**Implementer:** opus
**Files:** Create `backend/src/modules/mcp/tools/case-activity-recorder.ts`, `case-activity-recorder.spec.ts`; Modify `backend/src/modules/mcp/mcp.tools.ts`, `backend/src/modules/mcp/mcp.module.ts`.

Context (verified 2026-10-09): tools are registered with `server.registerTool(name, config, handler)` inside each tool service's `registerAll(server, auth)`; `McpToolsService.registerForScope(server, auth)` calls the four services. `AuthSuccess` (`mcp-auth.helper.ts`) has `principal` (`{ kind: 'mcp', userId, organizationId, sessionId }`) and `session` (`OAuthSessionEntity` with `id` and `surfaceLabel`). Handlers return `{ content, isError? }` envelopes and catch their own errors. `CaseAccessService.assertAccess(principal, caseId)` throws `ForbiddenException` when the caller cannot see the case. Before writing the map below, open each tool file and confirm the argument names; fix the map if a tool names its case differently.

**Step 1: Write the failing spec** `case-activity-recorder.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { McpActivityRecorder, MCP_CASE_TOOLS, MCP_UNSCOPED_TOOLS } from './case-activity-recorder';

const auth = {
  kind: 'oauth',
  user: { id: 'user-1' },
  session: { id: 'sess-1', surfaceLabel: 'Claude Desktop' },
  principal: { kind: 'mcp', userId: 'user-1', organizationId: 'org-1', sessionId: 'sess-1' },
} as any;

function setup() {
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const caseAccess = { assertAccess: jest.fn().mockResolvedValue(null) };
  const traceRepo = { findOne: jest.fn() };
  const productionRepo = { findOne: jest.fn() };
  const recorder = new McpActivityRecorder(activity as any, caseAccess as any, traceRepo as any, productionRepo as any);
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  const server = { registerTool: jest.fn((name: string, _c: unknown, h: any) => handlers.set(name, h)) } as any;
  const wrapped = recorder.wrap(server, auth);
  return { activity, caseAccess, traceRepo, productionRepo, wrapped, handlers, server };
}

const ok = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

it('records a case-scoped tool with the session label and id', async () => {
  const { activity, wrapped, handlers } = setup();
  wrapped.registerTool('get_case_data', {}, async () => ok({ investigations: [1, 2] }));
  const result = await handlers.get('get_case_data')!({ caseId: 'case-1' }, {});
  expect(result).toEqual(ok({ investigations: [1, 2] }));
  expect(activity.record).toHaveBeenCalledWith({
    caseId: 'case-1', userId: 'user-1', source: 'mcp', agent: 'Claude Desktop', mcpSessionId: 'sess-1',
    action: 'get_case_data', input: { caseId: 'case-1' }, status: 'ok', summary: { investigationsCount: 2 },
  });
});

it('resolves the case from a trace for import_transactions', async () => {
  const { activity, traceRepo, wrapped, handlers } = setup();
  traceRepo.findOne.mockResolvedValue({ id: 't1', investigation: { caseId: 'case-9' } });
  wrapped.registerTool('import_transactions', {}, async () => ok({ imported: 3 }));
  await handlers.get('import_transactions')!({ traceId: 't1', transactions: [] }, {});
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-9', action: 'import_transactions' }));
});

it('resolves the case from a production for update_production', async () => {
  const { activity, productionRepo, wrapped, handlers } = setup();
  productionRepo.findOne.mockResolvedValue({ id: 'p1', caseId: 'case-7' });
  wrapped.registerTool('update_production', {}, async () => ok({ id: 'p1' }));
  await handlers.get('update_production')!({ productionId: 'p1' }, {});
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-7' }));
});

it('registers unscoped tools untouched and never records them', async () => {
  const { activity, wrapped, server } = setup();
  const handler = async () => ok([]);
  wrapped.registerTool('list_cases', {}, handler);
  expect(server.registerTool).toHaveBeenCalledWith('list_cases', {}, handler);
  expect(activity.record).not.toHaveBeenCalled();
});

it('does not record into a case the caller cannot access', async () => {
  const { activity, caseAccess, wrapped, handlers } = setup();
  caseAccess.assertAccess.mockRejectedValue(new ForbiddenException());
  wrapped.registerTool('get_case', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'Forbidden' }] }));
  await handlers.get('get_case')!({ caseId: 'someone-elses' }, {});
  expect(activity.record).not.toHaveBeenCalled();
});

it('records error envelopes as failures', async () => {
  const { activity, wrapped, handlers } = setup();
  wrapped.registerTool('create_production', {}, async () => ({ isError: true, content: [{ type: 'text', text: 'Invalid data' }] }));
  await handlers.get('create_production')!({ caseId: 'case-1', name: 'R' }, {});
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', summary: { error: 'Invalid data' } }));
});

it('records a thrown handler as a failure and rethrows', async () => {
  const { activity, wrapped, handlers } = setup();
  wrapped.registerTool('get_case', {}, async () => { throw new Error('boom'); });
  await expect(handlers.get('get_case')!({ caseId: 'case-1' }, {})).rejects.toThrow('boom');
  expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', summary: { error: 'boom' } }));
});

it('classifies every tool exactly once', () => {
  for (const name of MCP_UNSCOPED_TOOLS) expect(MCP_CASE_TOOLS[name]).toBeUndefined();
});
```

Also add a coverage test to `backend/src/modules/mcp/mcp.tools.spec.ts` (or the spec that already builds `McpToolsService` with mocked dependencies): register all tools against a fake server that records names, and assert every registered name is in `Object.keys(MCP_CASE_TOOLS)` or `MCP_UNSCOPED_TOOLS`. This is what stops a new MCP tool from going unlogged. Build the four real tool services (`NavigateToolsService`, `ReadToolsService`, `BlockchainToolsService`, `WriteToolsService`) directly with `new`, passing `{}` for each constructor parameter (read each constructor to get the count; `ReadToolsService` takes 8, `WriteToolsService` 5); `registerAll` only registers, it does not call dependencies. Pass a fake `auth` like the recorder spec's and a server object `{ registerTool: (name: string) => names.push(name) }`.

**Step 2:** `npx jest src/modules/mcp/tools/case-activity-recorder.spec.ts` fails (module not found).

**Step 3: Implement** `case-activity-recorder.ts`. Use the same `McpServer` import path the tool files use.

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CaseActivityService } from '../../case-activity/case-activity.service';
import { ActivityOutcome, mcpToolOutcome, thrownOutcome } from '../../case-activity/activity-summaries';
import { CaseAccessService } from '../../auth/case-access.service';
import { TraceEntity } from '../../../database/entities/trace.entity';
import { ProductionEntity } from '../../../database/entities/production.entity';
import type { AuthSuccess } from '../mcp-auth.helper';

type CaseRef = { arg: 'caseId' } | { arg: 'traceId' } | { arg: 'productionId' };

/** How each case-scoped MCP tool names its case. */
export const MCP_CASE_TOOLS: Record<string, CaseRef> = {
  get_case: { arg: 'caseId' },
  list_investigations: { arg: 'caseId' },
  get_case_data: { arg: 'caseId' },
  read_production: { arg: 'caseId' },
  get_investigation: { arg: 'caseId' },
  list_data_room_files: { arg: 'caseId' },
  read_data_room_file: { arg: 'caseId' },
  create_investigation: { arg: 'caseId' },
  create_production: { arg: 'caseId' },
  import_transactions: { arg: 'traceId' },
  update_production: { arg: 'productionId' },
};

/** Tools that act on no case. They are not recorded. */
export const MCP_UNSCOPED_TOOLS: readonly string[] = [
  'list_cases',
  'query_labeled_entities',
  'get_skill',
  'get_declarants',
  'get_declaration_library',
  'blockchain_fetch_history',
  'blockchain_get_transaction',
  'blockchain_get_address_info',
];

type Handler = (...args: unknown[]) => Promise<unknown>;

/**
 * Records every case-scoped MCP tool call to the case activity log. Wraps the
 * server handed to the tool services, so tools stay unaware of logging.
 */
@Injectable()
export class McpActivityRecorder {
  constructor(
    private readonly activity: CaseActivityService,
    private readonly caseAccess: CaseAccessService,
    @InjectRepository(TraceEntity) private readonly traceRepo: Repository<TraceEntity>,
    @InjectRepository(ProductionEntity) private readonly productionRepo: Repository<ProductionEntity>,
  ) {}

  wrap(server: McpServer, auth: AuthSuccess): McpServer {
    const wrapped = Object.create(server) as McpServer;
    const register = server.registerTool.bind(server) as (name: string, config: unknown, handler: Handler) => unknown;
    (wrapped as unknown as { registerTool: unknown }).registerTool = (name: string, config: unknown, handler: Handler) => {
      if (!MCP_CASE_TOOLS[name]) return register(name, config, handler);
      return register(name, config, async (...cbArgs: unknown[]) => {
        const toolArgs = (cbArgs[0] ?? {}) as Record<string, unknown>;
        let result: unknown;
        try {
          result = await handler(...cbArgs);
        } catch (err) {
          await this.record(name, toolArgs, auth, thrownOutcome(err));
          throw err;
        }
        await this.record(name, toolArgs, auth, mcpToolOutcome(result));
        return result;
      });
    };
    return wrapped;
  }

  private async record(name: string, args: Record<string, unknown>, auth: AuthSuccess, outcome: ActivityOutcome) {
    try {
      const caseId = await this.resolveCaseId(name, args);
      if (!caseId) return;
      // Only cases the caller can see: a denied call must not write into another team's log.
      await this.caseAccess.assertAccess(auth.principal, caseId);
      await this.activity.record({
        caseId,
        userId: auth.principal.userId,
        source: 'mcp',
        agent: auth.session.surfaceLabel,
        mcpSessionId: auth.session.id,
        action: name,
        input: args,
        status: outcome.status,
        summary: outcome.summary,
      });
    } catch {
      // No access, or the target is gone: nothing to record.
    }
  }

  private async resolveCaseId(name: string, args: Record<string, unknown>): Promise<string | null> {
    const ref = MCP_CASE_TOOLS[name];
    const value = args[ref.arg];
    if (typeof value !== 'string') return null;
    if (ref.arg === 'caseId') return value;
    if (ref.arg === 'traceId') {
      const trace = await this.traceRepo.findOne({ where: { id: value }, relations: { investigation: true } });
      return trace?.investigation?.caseId ?? null;
    }
    const production = await this.productionRepo.findOne({ where: { id: value } });
    return production?.caseId ?? null;
  }
}
```

The test passes `{}` as `config`; the real call passes the tool config object. Keep `register(name, config, handler)` argument order identical to the SDK.

**Step 4: Wire it.**
- `mcp.tools.ts`: inject `private readonly activityRecorder: McpActivityRecorder` and in `registerForScope` do `const recorded = this.activityRecorder.wrap(server, auth);` and pass `recorded` to all four `registerAll` calls.
- `mcp.module.ts`: add `McpActivityRecorder` to `providers`, `CaseActivityModule` to `imports`, and `TraceEntity`, `ProductionEntity` to the `TypeOrmModule.forFeature([...])` list. Confirm `CaseAccessService` is already resolvable in `McpModule` (the tool services inject it); if it comes from `AuthModule`, it already is.
- Leave `AgentAuditService` and `write-tools.ts` untouched; the per-session security log keeps working as it is.
- `backend/src/modules/mcp/mcp.tools.spec.ts:45-47` builds `new McpToolsService(noopService, noopService, noopService, noopService)`. Add a fifth argument, `{ wrap: (s: unknown) => s } as any`, so the existing tests keep compiling and `registerForScope` still passes the server through.

**Step 5:** `npx jest src/modules/mcp/tools/case-activity-recorder.spec.ts src/modules/mcp/mcp.tools.spec.ts` passes (include whichever spec got the coverage test); `npx tsc --noEmit` passes. Run `git status`.

---

## Task 7: Migration with backfill

**Implementer:** opus
**Files:** Create `backend/src/database/migrations/<timestamp>-AddCaseActivityLog.ts`.

**Step 1:** From the repo root: `./migrations.sh --prod --dry-run`. If it lists any pending migration, STOP and report: generating now would fold unrelated schema drift into this migration.

**Step 2:** `./migrations.sh --prod --generate AddCaseActivityLog`. This only diffs; it does not change production.

**Step 3:** Open the generated file. It must contain only: `CREATE TABLE "case_activity_log"` (with `"created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now()`), `CREATE INDEX "ix_case_activity_log_case_created"`, and the two FKs (`case_id` CASCADE, `user_id` SET NULL), plus their reverse in `down()`. If it contains anything else, STOP and report.

**Step 4:** Append the backfill to the end of `up()`, after the FKs. It rebuilds chat entries from the tool calls still present in `messages` (the last 30 days). Chat tools report failure as a `{"error": ...}` JSON result, so that is how failure is detected:

```ts
        // Backfill: rebuild chat entries from tool calls in surviving messages.
        // Older chats were purged by the 30-day retention job and cannot be recovered.
        await queryRunner.query(`
            INSERT INTO "case_activity_log"
                ("case_id", "user_id", "source", "agent", "conversation_id", "action", "input", "status", "summary", "backfilled", "created_at")
            SELECT c."case_id", c."user_id", 'chat', tu."model", c."id",
                   b->>'name',
                   CASE WHEN length(COALESCE(b->'input', '{}'::jsonb)::text) > 16384
                        THEN jsonb_build_object('_truncated', true, 'preview', left((b->'input')::text, 16384))
                        ELSE COALESCE(b->'input', '{}'::jsonb) END,
                   CASE WHEN r."failed" OR ws."failed" THEN 'error' ELSE 'ok' END,
                   NULL, true, m."created_at"
            FROM "messages" m
            JOIN "conversations" c ON c."id" = m."conversation_id"
            CROSS JOIN LATERAL jsonb_array_elements(m."content") b
            LEFT JOIN LATERAL (
                SELECT t."model" FROM "token_usage" t WHERE t."message_id" = m."id" LIMIT 1
            ) tu ON true
            LEFT JOIN LATERAL (
                SELECT bool_or(
                           rb->>'content' LIKE '{"error":%'
                           OR (b->>'name' = 'execute_script'
                               AND (rb->>'content' LIKE '%"status":"error"%' OR rb->>'content' LIKE '%"status":"timeout"%'))
                       ) AS "failed"
                FROM "messages" m2
                CROSS JOIN LATERAL jsonb_array_elements(m2."content") rb
                WHERE m2."conversation_id" = m."conversation_id"
                  AND m2."role" = 'user'
                  AND rb->>'type' = 'tool_result'
                  AND rb->>'tool_use_id' = b->>'id'
            ) r ON true
            -- A web search result lives in the same assistant message; on failure its content is an object, not a list.
            LEFT JOIN LATERAL (
                SELECT bool_or(jsonb_typeof(wb->'content') = 'object') AS "failed"
                FROM jsonb_array_elements(m."content") wb
                WHERE wb->>'type' = 'web_search_tool_result' AND wb->>'tool_use_id' = b->>'id'
            ) ws ON true
            WHERE m."role" = 'assistant'
              AND (b->>'type' = 'tool_use' OR (b->>'type' = 'server_tool_use' AND b->>'name' = 'web_search'))
        `);
```

`down()` stays as generated (dropping the table removes backfilled rows).

Known limit, accepted: `create_production`, `read_production` and `update_production` results are stored slimmed to `{id, name, type}` (`slimToolResult`), which drops an `{error}`, so a failed production call backfills as `ok`. Live recording (Task 5) does not have this gap.

**Step 5: Validate on dev, rolled back.** The dev database is `docker exec -i daubert-db psql -U daubert -d daubert`. In one `BEGIN; ... ROLLBACK;` block: run the generated `CREATE TABLE`, index and FK statements (skip them if dev already has the table from `synchronize`); insert a fixture case under an existing organization, a conversation for an existing user, an assistant message with one `tool_use` (`get_case_data`) and one `server_tool_use` `web_search`, a user message with the matching `tool_result` whose content is `'{"error":"x"}'` for the first, and in the assistant message a `web_search_tool_result` for the search whose `content` is a list with one `web_search_result`; run the backfill `INSERT`; `SELECT action, status, backfilled FROM case_activity_log`. Expect two rows: `get_case_data | error | t` and `web_search | ok | t`. Then change the search result's `content` to `{"type":"web_search_tool_result_error","error_code":"max_uses_exceeded"}`, rerun, and expect `web_search | error | t`. Then `ROLLBACK`.

**Step 6:** Run `git status`. Do NOT run `./migrations.sh --prod --run`.

---

## Task 8: Frontend formatting helpers

**Implementer:** sonnet
**Files:** Create `frontend/src/components/Workspace/activityFormat.ts`, `frontend/src/components/Workspace/activityFormat.test.ts`.

**Step 1: Write the failing test** `activityFormat.test.ts`:

```ts
import { actionLabel, keyInput, sourceLabel } from './activityFormat';

describe('actionLabel', () => {
  it('names known tools and falls back to spaced names', () => {
    expect(actionLabel('get_case_data')).toBe('Read case data');
    expect(actionLabel('web_search')).toBe('Web search');
    expect(actionLabel('brand_new_tool')).toBe('brand new tool');
  });
});

describe('keyInput', () => {
  it('picks the first useful field for the tool', () => {
    expect(keyInput('web_search', { query: 'mixer flows' })).toBe('mixer flows');
    expect(keyInput('get_investigation', { address: '0xabc', investigationId: 'i1' })).toBe('0xabc');
    expect(keyInput('execute_script', { name: 'trace hops', code: '...' })).toBe('trace hops');
  });

  it('clips long values and handles tools without a key input', () => {
    expect(keyInput('web_search', { query: 'q'.repeat(100) })).toHaveLength(80);
    expect(keyInput('get_case_data', {})).toBeNull();
    expect(keyInput('web_search', null)).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('names the chat and the MCP surface', () => {
    expect(sourceLabel({ source: 'chat', agent: 'claude-opus-5' })).toBe('Daubert chat');
    expect(sourceLabel({ source: 'mcp', agent: 'Claude Desktop' })).toBe('Claude Desktop');
    expect(sourceLabel({ source: 'mcp', agent: null })).toBe('External agent');
  });
});
```

**Step 2:** From `frontend/`: `npx jest src/components/Workspace/activityFormat.test.ts` fails.

**Step 3: Implement** `activityFormat.ts`:

```ts
const LABELS: Record<string, string> = {
  web_search: 'Web search',
  get_case_data: 'Read case data',
  get_case: 'Read case',
  get_investigation: 'Read investigation',
  list_investigations: 'Listed investigations',
  create_investigation: 'Created investigation',
  import_transactions: 'Imported transactions',
  get_skill: 'Loaded skill',
  execute_script: 'Ran script',
  list_script_runs: 'Listed past scripts',
  query_labeled_entities: 'Looked up labeled entities',
  create_production: 'Created production',
  read_production: 'Read production',
  update_production: 'Updated production',
  get_declaration_library: 'Read declaration library',
  get_declarants: 'Read declarants',
  list_data_room_files: 'Listed data room files',
  read_data_room_file: 'Read data room file',
  add_label: 'Added label',
  update_label: 'Updated label',
  delete_label: 'Deleted label',
  move_label: 'Moved label',
  tether_label: 'Tethered label',
};

/** The input field that best identifies what a call was about, in order of preference. */
const KEY_INPUT: Record<string, string[]> = {
  web_search: ['query'],
  get_investigation: ['address', 'investigationId'],
  create_investigation: ['name'],
  import_transactions: ['traceId'],
  get_skill: ['name'],
  execute_script: ['name'],
  query_labeled_entities: ['address', 'search'],
  create_production: ['name'],
  read_production: ['productionId'],
  update_production: ['productionId'],
  read_data_room_file: ['fileId'],
  add_label: ['text'],
  update_label: ['labelId'],
  delete_label: ['labelId'],
  move_label: ['labelId'],
  tether_label: ['labelId'],
};

const KEY_INPUT_MAX = 80;

export function actionLabel(action: string): string {
  return LABELS[action] ?? action.replace(/_/g, ' ');
}

export function keyInput(action: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  for (const key of KEY_INPUT[action] ?? []) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) {
      return v.length > KEY_INPUT_MAX ? `${v.slice(0, KEY_INPUT_MAX - 3)}...` : v;
    }
  }
  return null;
}

export function sourceLabel(entry: { source: 'chat' | 'mcp'; agent: string | null }): string {
  if (entry.source === 'chat') return 'Daubert chat';
  return entry.agent ?? 'External agent';
}
```

**Step 4:** The test passes. Run `git status`.

---

## Task 9: Activity page and sidebar entry

**Implementer:** sonnet
**Files:** Create `frontend/src/app/cases/[caseId]/(workspace)/activity/page.tsx`, `page.spec.tsx`; Modify `frontend/src/components/Workspace/InvestigationsSidebar.tsx`.

**Step 1: Write the failing spec** `activity/page.spec.tsx`, mocking like `data-room/page.spec.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { components } from '@/generated/api-types';

type Page = components['schemas']['CaseActivityPage'];
type Entry = components['schemas']['CaseActivityEntry'];

jest.mock('next/navigation', () => ({ useParams: () => ({ caseId: 'case-123' }) }));
const mockList = jest.fn<Promise<Page>, [string, (string | null)?, number?]>();
jest.mock('@/lib/api-client', () => ({
  apiClient: { listCaseActivity: (...args: [string, (string | null)?, number?]) => mockList(...args) },
}));
jest.mock('@/components/Common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}));
jest.mock('@/components/Auth/UserMenu', () => ({ __esModule: true, default: () => <div data-testid="user-menu" /> }));
jest.mock('@/components/Common/Loader', () => ({ Loader: () => <div data-testid="loader" /> }));

import ActivityPage from './page';

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'e1', createdAt: '2026-10-09T12:00:00.000Z', source: 'chat', agent: 'claude-opus-5',
    action: 'web_search', input: { query: 'mixer flows' }, status: 'ok',
    summary: { sources: [{ title: 'T', url: 'https://u' }] }, backfilled: false, conversationId: 'c1',
    user: { id: 'u1', name: 'Ana Ruiz', email: 'ana@firm.com' },
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

it('lists entries with action, key input, who and source', async () => {
  mockList.mockResolvedValue({ items: [entry(), entry({ id: 'e2', source: 'mcp', agent: 'Claude Desktop', action: 'get_case_data', input: {}, status: 'error', summary: { error: 'Forbidden' } })], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('Web search')).toBeTruthy());
  expect(screen.getByText('mixer flows')).toBeTruthy();
  expect(screen.getAllByText('Ana Ruiz').length).toBe(2);
  expect(screen.getByText('Daubert chat')).toBeTruthy();
  expect(screen.getByText('Claude Desktop')).toBeTruthy();
  expect(screen.getByText('Failed')).toBeTruthy();
  expect(mockList).toHaveBeenCalledWith('case-123', null, 50);
});

it('expands a row to show its input and summary', async () => {
  mockList.mockResolvedValue({ items: [entry()], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('Web search')).toBeTruthy());
  fireEvent.click(screen.getByText('Web search'));
  expect(screen.getByText(/"query": "mixer flows"/)).toBeTruthy();
  expect(screen.getByText(/https:\/\/u/)).toBeTruthy();
});

it('loads the next page', async () => {
  mockList
    .mockResolvedValueOnce({ items: [entry()], nextCursor: 'cur-1' })
    .mockResolvedValueOnce({ items: [entry({ id: 'e9', action: 'execute_script', input: { name: 'hops' } })], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('Load more')).toBeTruthy());
  fireEvent.click(screen.getByText('Load more'));
  await waitFor(() => expect(screen.getByText('Ran script')).toBeTruthy());
  expect(mockList).toHaveBeenLastCalledWith('case-123', 'cur-1', 50);
  expect(screen.queryByText('Load more')).toBeNull();
});

it('shows an empty state', async () => {
  mockList.mockResolvedValue({ items: [], nextCursor: null });
  render(<ActivityPage />);
  await waitFor(() => expect(screen.getByText('No agent activity on this case yet.')).toBeTruthy());
});
```

**Step 2:** From `frontend/`: `npx jest "src/app/cases/\[caseId\]/(workspace)/activity/page.spec.tsx"` fails.

**Step 3: Implement** `activity/page.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';
import { Loader } from '@/components/Common/Loader';
import { actionLabel, keyInput, sourceLabel } from '@/components/Workspace/activityFormat';

type Entry = components['schemas']['CaseActivityEntry'];

const PAGE_SIZE = 50;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function ActivityRow({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const key = keyInput(entry.action, entry.input);
  const who = entry.user?.name || entry.user?.email || 'Former member';
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-raised transition-colors"
        aria-expanded={open}
      >
        {open ? <FaChevronDown size={10} className="text-ink-faint shrink-0" /> : <FaChevronRight size={10} className="text-ink-faint shrink-0" />}
        <span className="w-40 shrink-0 text-xs text-ink-muted">{formatTime(entry.createdAt)}</span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-ink">{actionLabel(entry.action)}</span>
          {key && <span className="ml-2 font-mono text-xs text-ink-muted truncate">{key}</span>}
        </span>
        <span className="w-36 shrink-0 truncate text-xs text-ink-muted">{who}</span>
        <span className="w-32 shrink-0 truncate rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-muted text-center">
          {sourceLabel(entry)}
        </span>
        <span className={`w-14 shrink-0 text-right text-xs ${entry.status === 'error' ? 'text-redline' : 'text-ink-faint'}`}>
          {entry.status === 'error' ? 'Failed' : 'OK'}
        </span>
      </button>
      {open && (
        <div className="grid gap-3 px-11 pb-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Input</p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-raised p-3 text-xs text-ink-soft whitespace-pre-wrap break-all">
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Result</p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-raised p-3 text-xs text-ink-soft whitespace-pre-wrap break-all">
              {entry.summary ? JSON.stringify(entry.summary, null, 2) : 'No summary'}
            </pre>
            <p className="mt-2 text-[11px] text-ink-faint">
              {entry.agent ? `Agent: ${entry.agent}` : null}
              {entry.backfilled ? ' · Rebuilt from chat history' : null}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

export default function ActivityPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const [items, setItems] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      const page = await apiClient.listCaseActivity(caseId, from, PAGE_SIZE);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    },
    [caseId],
  );

  useEffect(() => {
    setLoading(true);
    load(null)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load activity'))
      .finally(() => setLoading(false));
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      await load(cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Activity" rightContent={<UserMenu />} />
      <div className="flex-1 overflow-y-auto p-6">
        <p className="mb-4 max-w-2xl text-sm text-ink-muted">
          Every action an AI agent took on this case, from Daubert chat and from connected agents. Entries are kept with
          the case and cannot be edited or deleted.
        </p>
        {error && (
          <div className="mb-4 rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">{error}</div>
        )}
        {loading ? (
          <Loader inline />
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">No agent activity on this case yet.</p>
        ) : (
          <>
            <ul className="rounded-xl border border-line bg-surface">
              {items.map((e) => (
                <ActivityRow key={e.id} entry={e} />
              ))}
            </ul>
            {cursor && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm text-ink hover:bg-surface-raised disabled:opacity-60"
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Sidebar entry.** In `InvestigationsSidebar.tsx`, add `FaClockRotateLeft` to the `react-icons/fa6` import. Directly after the Data Room block (the IIFE that renders the `/data-room` link, ~lines 278-301), add the same block for Activity, without the top border wrapper's `mt-2 pt-2 border-t` (it sits under Data Room):

```tsx
        {(() => {
          const activityHref = `/cases/${caseId}/activity`;
          const activityActive = pathname === activityHref || pathname?.startsWith(activityHref + '/');
          return (
            <div>
              <a
                href={activityHref}
                onClick={(e) => { e.preventDefault(); router.push(activityHref); }}
                className={`flex items-center gap-2 mx-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors ${
                  activityActive ? 'bg-surface border border-line-strong text-ink' : 'text-ink-muted hover:bg-surface-raised hover:text-ink'
                }`}
              >
                <FaClockRotateLeft size={12} className="shrink-0 text-ink-faint" />
                <span className="font-medium">Activity</span>
              </a>
            </div>
          );
        })()}
```

**Step 5:** The page spec passes; from `frontend/`: `npx tsc --noEmit` passes. Run `git status`.

---

## Task 10: Docs

**Implementer:** sonnet
**Files:** Modify `docs/chat-retention.md`.

**Step 1:** In `docs/chat-retention.md`, section "What it keeps", add a bullet: "`case_activity_log`: one entry per action an AI agent took on a case (tool, inputs, outcome, short summary), for the life of the case. The purge never touches it, so the methodology stays reviewable after the chat is gone." In "Not covered by this policy", leave `script_runs` and `agent_audit_log.detail` as they are.

**Step 2:** Run `git status`.

---

## Engineering Decisions Made

- `created_at` is `timestamptz(3)` and the entity does not extend `BaseEntity`, so the keyset cursor round-trips through JavaScript exactly and the log has no `updated_at`.
- Logging is best-effort (`case_activity_log_write_failed`), unlike the data room custody log, because failing an agent turn over its log write would hurt the user more than a missing row.
- MCP recording lives in one wrapper around tool registration, with a test that fails if a new MCP tool is not classified as case-scoped or unscoped.
- Inputs are capped at 16 KB; result summaries keep only top-level scalars (clipped to 200 characters) and array sizes.
- The backfill runs inside the migration so production gets it exactly once; MCP history is not backfilled (no case id, reads never recorded).

## Follow-ups (not in this plan)

- Website: Terms section 5 and the Privacy Policy say the activity log is case data kept for the life of the case; restore the "Auditable" pillar copy. Do this when the feature is deployed.
- Deploy order: deploy the backend first, then run the migration. Until the table exists, live writes fail softly (`case_activity_log_write_failed`) and the backfill picks those turns up from `messages`, so nothing is lost or duplicated. Running the migration first would lose tool calls made by the old code in between.
