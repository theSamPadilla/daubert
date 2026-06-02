import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrgRoleGuard } from './org-role.guard';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { REQUIRED_ORG_ROLE_KEY } from './require-org-role.decorator';

interface FakeRequest {
  user?: any;
  params?: Record<string, string>;
  organization?: any;
  orgMembership?: any;
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
  let memberRepo: { findOneBy: jest.Mock };
  let orgRepo: { findOneBy: jest.Mock };

  const activeOrg = { id: 'org-1', slug: 'acme', deletedAt: null };

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue('guest') };
    memberRepo = { findOneBy: jest.fn() };
    orgRepo = { findOneBy: jest.fn().mockResolvedValue(activeOrg) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgRoleGuard,
        { provide: Reflector, useValue: reflector },
        { provide: getRepositoryToken(OrganizationMemberEntity), useValue: memberRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
      ],
    }).compile();

    guard = module.get(OrgRoleGuard);
  });

  it('throws ForbiddenException when req.user is not set', async () => {
    const req: FakeRequest = { params: { org: 'acme' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
      new ForbiddenException('Authentication required'),
    );
  });

  it('throws ForbiddenException when :org param is missing', async () => {
    const req: FakeRequest = { user: { id: 'user-1' }, params: {} };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
      new ForbiddenException('OrgRoleGuard applied to a non-org route'),
    );
  });

  it('throws NotFoundException when org slug does not match an active org', async () => {
    orgRepo.findOneBy.mockResolvedValue(null);
    const req: FakeRequest = { user: { id: 'user-1' }, params: { org: 'ghost' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when user has no membership in the org', async () => {
    memberRepo.findOneBy.mockResolvedValue(null);
    const req: FakeRequest = { user: { id: 'user-1' }, params: { org: 'acme' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
      new ForbiddenException('You do not have access to this organization'),
    );
  });

  it("throws ForbiddenException when user's org role is below the required minimum", async () => {
    reflector.getAllAndOverride.mockReturnValue('admin');
    memberRepo.findOneBy.mockResolvedValue({ userId: 'user-1', organizationId: 'org-1', role: 'guest' });
    const req: FakeRequest = { user: { id: 'user-1' }, params: { org: 'acme' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toThrow(
      new ForbiddenException("Requires org role 'admin' or higher"),
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(REQUIRED_ORG_ROLE_KEY, expect.any(Array));
  });

  it('returns true, attaches org and membership when role meets the minimum', async () => {
    reflector.getAllAndOverride.mockReturnValue('member');
    const membership = { userId: 'user-1', organizationId: 'org-1', role: 'admin' };
    memberRepo.findOneBy.mockResolvedValue(membership);
    const req: FakeRequest = { user: { id: 'user-1' }, params: { org: 'acme' } };

    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.organization).toBe(activeOrg);
    expect(req.orgMembership).toBe(membership);
  });
});
