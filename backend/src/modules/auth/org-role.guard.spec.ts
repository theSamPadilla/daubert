import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OrgRoleGuard } from './org-role.guard';
import { REQUIRED_ORG_ROLE_KEY } from './require-org-role.decorator';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeRequest {
  user?: any;
}

function makeContext(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => null,
    getClass: () => null,
    getArgs: () => [] as any,
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('OrgRoleGuard', () => {
  let guard: OrgRoleGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue('guest') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgRoleGuard,
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    guard = module.get(OrgRoleGuard);
  });

  // ── 1: No req.user ────────────────────────────────────────────────────────

  it('throws ForbiddenException when req.user is not set', () => {
    const req: FakeRequest = {};
    const ctx = makeContext(req);

    expect(() => guard.canActivate(ctx)).toThrow(
      new ForbiddenException('Authentication required'),
    );
  });

  // ── 2: Role too low ───────────────────────────────────────────────────────

  it("throws ForbiddenException when user's org role is below the required minimum", () => {
    reflector.getAllAndOverride.mockReturnValue('admin');

    const req: FakeRequest = { user: { id: 'user-1', orgRole: 'guest' } };
    const ctx = makeContext(req);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow(
      "Requires org role 'admin' or higher",
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRED_ORG_ROLE_KEY,
      expect.any(Array),
    );
  });

  // ── 3: Role meets or exceeds minRole ──────────────────────────────────────

  it("returns true when user's org role meets the required minimum", () => {
    reflector.getAllAndOverride.mockReturnValue('member');

    const req: FakeRequest = { user: { id: 'user-1', orgRole: 'admin' } };
    const ctx = makeContext(req);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  // ── 4: Missing @RequireOrgRole metadata ───────────────────────────────────

  it('throws Error when no @RequireOrgRole metadata is declared', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const req: FakeRequest = { user: { id: 'user-1', orgRole: 'admin' } };
    const ctx = makeContext(req);

    expect(() => guard.canActivate(ctx)).toThrow(
      'OrgRoleGuard used without @RequireOrgRole — declare a minimum role',
    );
  });
});
