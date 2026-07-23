import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { CaseAccessService } from '../auth/case-access.service';
import { CreateCaseDto } from './dto/create-case.dto';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(role?: string) {
  return {
    user: { id: 'user-1' },
    caseMembership: role ? { role } : undefined,
  };
}

const BASE_CASE = {
  id: 'case-1',
  name: 'Test Case',
  investigations: [],
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('CasesController', () => {
  let controller: CasesController;
  let service: jest.Mocked<CasesService>;

  beforeEach(async () => {
    const mockService: Partial<jest.Mocked<CasesService>> = {
      findAllForUser: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      createWithOwner: jest.fn(),
      addMemberByEmail: jest.fn(),
    };

    // RoleGuard is pulled in via @RequireRole on controller methods;
    // provide the repos it needs so the DI graph resolves.
    const mockMemberRepo = { findOneBy: jest.fn() };
    const mockCaseRepo = { findOneBy: jest.fn() };
    const mockOrgMemberRepo = { findOneBy: jest.fn() };
    const mockOrgRepo = { findOneBy: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CasesController],
      providers: [
        { provide: CasesService, useValue: mockService },
        CaseAccessService,
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn().mockReturnValue(null) } },
        { provide: getRepositoryToken(CaseMemberEntity), useValue: mockMemberRepo },
        { provide: getRepositoryToken(CaseEntity), useValue: mockCaseRepo },
        { provide: getRepositoryToken(OrganizationMemberEntity), useValue: mockOrgMemberRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: mockOrgRepo },
      ],
    }).compile();

    controller = module.get<CasesController>(CasesController);
    service = module.get(CasesService);
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  it('findAll: throws ForbiddenException when req.user is not set', () => {
    expect(() => controller.findAll({ user: undefined })).toThrow(ForbiddenException);
    expect(service.findAllForUser).not.toHaveBeenCalled();
  });

  it('findAll: delegates to service.findAllForUser with req.user', async () => {
    const user = { id: 'user-1' };
    service.findAllForUser.mockResolvedValue([]);
    const result = await controller.findAll({ user });
    expect(service.findAllForUser).toHaveBeenCalledWith(user);
    expect(result).toEqual([]);
  });

  // ── findOne plumbing: passes req.caseMembership.role to service ───────────

  it('findOne: passes viewer role to service.findOne', async () => {
    const expected = { ...BASE_CASE, role: 'viewer' };
    service.findOne.mockResolvedValue(expected as any);

    const result = await controller.findOne('case-1', makeReq('viewer'));

    expect(service.findOne).toHaveBeenCalledWith('case-1', 'viewer');
    expect(result).toEqual(expected);
  });

  it('findOne: viewer response has role "viewer" and no members field', async () => {
    // Service strips members for viewers — controller passes the role through.
    // This test asserts the plumbing: controller calls findOne with 'viewer'
    // and returns whatever the service returns unchanged.
    const serviceResponse = { ...BASE_CASE, role: 'viewer' };
    // members key is absent (service already stripped it)
    expect(serviceResponse).not.toHaveProperty('members');
    service.findOne.mockResolvedValue(serviceResponse as any);

    const result = await controller.findOne('case-1', makeReq('viewer'));

    expect(service.findOne).toHaveBeenCalledWith('case-1', 'viewer');
    expect((result as any).role).toBe('viewer');
    expect(result).not.toHaveProperty('members');
  });

  it('findOne: passes editor role to service.findOne, response includes members', async () => {
    const members = [{ id: 'm-1', role: 'editor' }];
    const expected = { ...BASE_CASE, members, role: 'editor' };
    service.findOne.mockResolvedValue(expected as any);

    const result = await controller.findOne('case-1', makeReq('editor'));

    expect(service.findOne).toHaveBeenCalledWith('case-1', 'editor');
    expect((result as any).role).toBe('editor');
    expect((result as any).members).toEqual(members);
  });

  it('findOne: passes owner role to service.findOne, response includes members', async () => {
    const members = [{ id: 'm-1', role: 'owner' }];
    const expected = { ...BASE_CASE, members, role: 'owner' };
    service.findOne.mockResolvedValue(expected as any);

    const result = await controller.findOne('case-1', makeReq('owner'));

    expect(service.findOne).toHaveBeenCalledWith('case-1', 'owner');
    expect((result as any).role).toBe('owner');
    expect((result as any).members).toEqual(members);
  });

  // ── create (POST /cases) ──────────────────────────────────────────────────

  it('create: member — calls createWithOwner with ownerUserId from req.user.id and DTO fields', async () => {
    const dto: CreateCaseDto = { name: 'New Case', summary: 'Embezzlement at FTX', orgId: 'org-1' };
    const saved = { ...BASE_CASE, name: dto.name };
    service.createWithOwner!.mockResolvedValue(saved as any);

    const req = { user: { id: 'member-user-1' } };
    const result = await controller.create(dto, req);

    expect(service.createWithOwner).toHaveBeenCalledWith({
      name: 'New Case',
      ownerUserId: 'member-user-1',
      orgId: 'org-1',
      summary: 'Embezzlement at FTX',
    });
    expect(result).toEqual(saved);
  });

  it('create: admin — calls createWithOwner with ownerUserId from req.user.id and DTO fields', async () => {
    const dto: CreateCaseDto = { name: 'Admin Case', orgId: 'org-1' };
    const saved = { ...BASE_CASE, name: dto.name };
    service.createWithOwner!.mockResolvedValue(saved as any);

    const req = { user: { id: 'admin-user-1' } };
    const result = await controller.create(dto, req);

    expect(service.createWithOwner).toHaveBeenCalledWith({
      name: 'Admin Case',
      ownerUserId: 'admin-user-1',
      orgId: 'org-1',
      summary: null,
    });
    expect(result).toEqual(saved);
  });

  // ── addMember (POST /cases/:caseId/members) ──────────────────────────────

  it('addMember: owner — calls addMemberByEmail with caseId, email, role and returns membership', async () => {
    const membership = { id: 'mem-1', caseId: 'case-1', userId: 'user-2', role: 'editor' };
    service.addMemberByEmail!.mockResolvedValue(membership as any);

    const dto = { email: 'guest@example.com', role: 'editor' as const };
    const result = await controller.addMember('case-1', dto as any);

    expect(service.addMemberByEmail).toHaveBeenCalledWith('case-1', 'guest@example.com', 'editor');
    expect(result).toEqual(membership);
  });

  it('addMember: propagates NotFoundException from service', async () => {
    service.addMemberByEmail!.mockRejectedValue(new NotFoundException('User not found'));

    await expect(controller.addMember('case-1', { email: 'nobody@example.com', role: 'viewer' } as any))
      .rejects.toThrow(NotFoundException);
  });

  it('addMember: propagates ConflictException from service', async () => {
    service.addMemberByEmail!.mockRejectedValue(new ConflictException('Already a member'));

    await expect(controller.addMember('case-1', { email: 'existing@example.com', role: 'viewer' } as any))
      .rejects.toThrow(ConflictException);
  });
});
