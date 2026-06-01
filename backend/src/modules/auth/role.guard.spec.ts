import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RoleGuard } from './role.guard';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { REQUIRED_ROLE_KEY } from './require-role.decorator';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeRequest {
  user?: any;
  params?: Record<string, string>;
  caseMembership?: any;
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

describe('RoleGuard', () => {
  let guard: RoleGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let memberRepo: { findOneBy: jest.Mock };
  let caseRepo: { findOneBy: jest.Mock };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(null) };
    memberRepo = { findOneBy: jest.fn() };
    caseRepo = { findOneBy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleGuard,
        { provide: Reflector, useValue: reflector },
        { provide: getRepositoryToken(CaseMemberEntity), useValue: memberRepo },
        { provide: getRepositoryToken(CaseEntity), useValue: caseRepo },
      ],
    }).compile();

    guard = module.get(RoleGuard);
  });

  // ── 1: No req.user ────────────────────────────────────────────────────────

  it('throws ForbiddenException when req.user is not set', async () => {
    const req: FakeRequest = { params: { caseId: 'case-1' } };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new ForbiddenException('Authentication required'),
    );
  });

  // ── 2: Case not found ─────────────────────────────────────────────────────

  it('throws NotFoundException when the case does not exist', async () => {
    caseRepo.findOneBy.mockResolvedValue(null);

    const req: FakeRequest = {
      user: { id: 'user-1' },
      params: { caseId: 'nonexistent-case' },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── 3: No membership ──────────────────────────────────────────────────────

  it('throws ForbiddenException when the user has no membership in the case', async () => {
    caseRepo.findOneBy.mockResolvedValue({ id: 'case-1' });
    memberRepo.findOneBy.mockResolvedValue(null);

    const req: FakeRequest = {
      user: { id: 'user-1' },
      params: { caseId: 'case-1' },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new ForbiddenException('You do not have access to this case'),
    );
  });

  // ── 4: Role too low ───────────────────────────────────────────────────────

  it("throws ForbiddenException when membership role is below the required minimum", async () => {
    caseRepo.findOneBy.mockResolvedValue({ id: 'case-1' });
    memberRepo.findOneBy.mockResolvedValue({ userId: 'user-1', caseId: 'case-1', role: 'viewer' });
    reflector.getAllAndOverride.mockReturnValue('owner');

    const req: FakeRequest = {
      user: { id: 'user-1' },
      params: { caseId: 'case-1' },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new ForbiddenException("Requires role 'owner' or higher"),
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      REQUIRED_ROLE_KEY,
      expect.any(Array),
    );
  });

  // ── 5: Membership meets minRole ───────────────────────────────────────────

  it('returns true and attaches caseMembership when role meets the minimum', async () => {
    const membership = { userId: 'user-1', caseId: 'case-1', role: 'editor' };
    caseRepo.findOneBy.mockResolvedValue({ id: 'case-1' });
    memberRepo.findOneBy.mockResolvedValue(membership);
    reflector.getAllAndOverride.mockReturnValue('editor');

    const req: FakeRequest = {
      user: { id: 'user-1' },
      params: { caseId: 'case-1' },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.caseMembership).toBe(membership);
  });
});
