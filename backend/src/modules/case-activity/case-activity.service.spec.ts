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

    const page = await service.list('case-1', undefined, 2, true);

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

    const page = await service.list('case-1', encodeCursor(row(2)), 2, true);

    expect(qb.andWhere).toHaveBeenCalledWith('(a.createdAt, a.id) < (:ts, :id)', {
      ts: row(2).createdAt,
      id: row(2).id,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('returns no user and skips the user join when showUsers is false', async () => {
    const qb = qbMock([row(2), row(1)]);
    repo.createQueryBuilder.mockReturnValue(qb);

    const page = await service.list('case-1', undefined, 5, false);

    expect(qb.leftJoinAndSelect).not.toHaveBeenCalled();
    expect(page.items.every((i) => i.user === null)).toBe(true);
  });
});
