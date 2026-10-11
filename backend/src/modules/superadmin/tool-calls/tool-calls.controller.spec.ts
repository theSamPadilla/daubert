import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SuperAdminGuard } from '../../auth/super-admin.guard';
import { SuperadminToolCallsController } from './tool-calls.controller';
import { ToolCallsService } from './tool-calls.service';

function ctx(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('SuperadminToolCallsController', () => {
  const svc = {
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    summary: jest.fn().mockResolvedValue([]),
  };

  async function build() {
    const mod = await Test.createTestingModule({
      controllers: [SuperadminToolCallsController],
      providers: [{ provide: ToolCallsService, useValue: svc }],
    }).compile();
    return mod.get(SuperadminToolCallsController);
  }

  beforeEach(() => jest.clearAllMocks());

  it('is guarded by SuperAdminGuard, which rejects non-superadmins and anonymous callers', () => {
    const guards: unknown[] = Reflect.getMetadata('__guards__', SuperadminToolCallsController);
    expect(guards).toContain(SuperAdminGuard);
    const guard = new SuperAdminGuard();
    expect(() => guard.canActivate(ctx({ id: 'u1', isSuperAdmin: false }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx({ id: 'u1', isSuperAdmin: true }))).toBe(true);
  });

  it('list passes only known filters, cursor and default limit 100', async () => {
    const c = await build();
    await c.list({ orgId: 'o', action: 'read_data_room_file', bogus: 'x', status: '' }, 'cur');
    expect(svc.list).toHaveBeenCalledWith({ orgId: 'o', action: 'read_data_room_file' }, 'cur', 100);
  });

  it('summary uses the same filters', async () => {
    const c = await build();
    await c.summary({ conversationId: 'cv', cursor: 'ignored' });
    expect(svc.summary).toHaveBeenCalledWith({ conversationId: 'cv' });
  });
});

describe('ToolCallsService', () => {
  const ds = { query: jest.fn() };
  const service = new ToolCallsService(ds as never);
  const id = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => ds.query.mockReset());

  it('builds parameterised filters, joins, and a next cursor when more rows exist', async () => {
    const mk = (n: number) => ({
      id: `00000000-0000-4000-8000-00000000000${n}`,
      created_at: new Date(`2026-10-0${n}T00:00:00.000Z`),
      case_id: id, source: 'chat', action: 'a', status: 'ok', input: {}, summary: null, backfilled: false,
    });
    ds.query.mockResolvedValue([mk(3), mk(2), mk(1)]);
    const page = await service.list({ orgId: id, status: 'error' }, undefined, 2);
    const [sql, params] = ds.query.mock.calls[0];
    expect(sql).toContain('c.organization_id = $1');
    expect(sql).toContain('a.status = $2');
    expect(params).toEqual([id, 'error', 3]);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(`2026-10-02T00:00:00.000Z|00000000-0000-4000-8000-000000000002`);
  });

  it('applies a keyset predicate for a cursor and rejects bad input', async () => {
    ds.query.mockResolvedValue([]);
    await service.list({}, `2026-10-02T00:00:00.000Z|${id}`, 10);
    expect(ds.query.mock.calls[0][0]).toContain('(a.created_at, a.id) < ($1, $2)');
    await expect(service.list({}, 'junk', 10)).rejects.toThrow('Invalid cursor');
    await expect(service.list({ caseId: 'nope' }, undefined, 10)).rejects.toThrow('caseId');
    await expect(service.summary({ from: 'xx' })).rejects.toThrow('from');
  });

  it('summary returns numeric counts', async () => {
    ds.query.mockResolvedValue([{ action: 'a', status: 'ok', count: '7' }]);
    expect(await service.summary({})).toEqual([{ action: 'a', status: 'ok', count: 7 }]);
  });
});
