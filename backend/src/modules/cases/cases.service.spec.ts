import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CaseRole } from '../../database/entities/case-member.entity';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockMemberRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockOrgMemberRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn(),
};

const mockUsersService = {
  findByEmail: jest.fn(),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CASE_ID = 'case-1';
const OWNER_ID = 'user-owner';
const EDITOR_ID = 'user-editor';

function makeMember(userId: string, role: CaseRole) {
  return { id: `m-${userId}`, userId, caseId: CASE_ID, role } as any;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  return new CasesService(mockRepo as any, mockMemberRepo as any, mockOrgMemberRepo as any, mockDataSource as any, mockUsersService as any);
}

/**
 * Wire dataSource.transaction to invoke the callback with a mock EntityManager.
 * Returns the mock manager so individual tests can set up method return values.
 */
function setupTransaction(managerOverrides: Partial<{
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  count: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
}> = {}) {
  const mockManager = {
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    remove: jest.fn().mockResolvedValue(undefined),
    ...managerOverrides,
  };
  mockDataSource.transaction.mockImplementation((cb: (m: any) => Promise<any>) => cb(mockManager));
  return mockManager;
}

// ── ≥1 owner invariant: updateMemberRole ─────────────────────────────────────

describe('CasesService — ≥1 owner invariant: updateMemberRole', () => {
  let service: CasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('wraps the operation in a transaction', async () => {
    const member = makeMember(EDITOR_ID, 'editor');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'owner' });

    await service.updateMemberRole(CASE_ID, EDITOR_ID, 'owner');

    expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('demoting the only owner throws ConflictException', async () => {
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(makeMember(OWNER_ID, 'owner')),
      count: jest.fn().mockResolvedValue(1),
    });
    // suppress unused-var warning
    void mgr;

    await expect(service.updateMemberRole(CASE_ID, OWNER_ID, 'editor')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateMemberRole(CASE_ID, OWNER_ID, 'viewer')).rejects.toBeInstanceOf(ConflictException);
  });

  it('demoting one of two owners succeeds', async () => {
    const member = makeMember(OWNER_ID, 'owner');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(2),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'editor' });

    const result = await service.updateMemberRole(CASE_ID, OWNER_ID, 'editor');

    expect(mgr.count).toHaveBeenCalledWith(
      expect.anything(),
      { where: { caseId: CASE_ID, role: 'owner' } },
    );
    expect(result.role).toBe('editor');
  });

  it('promoting a non-owner skips the invariant check entirely', async () => {
    const member = makeMember(EDITOR_ID, 'editor');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'owner' });

    await service.updateMemberRole(CASE_ID, EDITOR_ID, 'owner');

    // count must NOT be called when promoting to owner
    expect(mgr.count).not.toHaveBeenCalled();
  });
});

// ── ≥1 owner invariant: removeMember ─────────────────────────────────────────

describe('CasesService — ≥1 owner invariant: removeMember', () => {
  let service: CasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('removing the only owner throws ConflictException', async () => {
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(makeMember(OWNER_ID, 'owner')),
      count: jest.fn().mockResolvedValue(1),
    });

    await expect(service.removeMember(CASE_ID, OWNER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('removing a non-existent member throws NotFoundException', async () => {
    // assertNotLastOwner sees null → short-circuits (not owner)
    // then the second findOneBy also returns null → NotFoundException
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(null),
    });

    await expect(service.removeMember(CASE_ID, 'unknown-user')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── ≥1 owner invariant: leave ────────────────────────────────────────────────

describe('CasesService — ≥1 owner invariant: leave', () => {
  let service: CasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('last owner self-leaves throws ConflictException', async () => {
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(makeMember(OWNER_ID, 'owner')),
      count: jest.fn().mockResolvedValue(1),
    });

    await expect(service.leave(CASE_ID, OWNER_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('editor self-leave succeeds', async () => {
    const member = makeMember(EDITOR_ID, 'editor');
    // assertNotLastOwner: findOneBy returns editor (role !== owner → short-circuits)
    // leave's own findOneBy: returns the member
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
    });

    await service.leave(CASE_ID, EDITOR_ID);

    expect(mgr.remove).toHaveBeenCalledWith(member);
  });

  it('non-member self-leave throws NotFoundException', async () => {
    // assertNotLastOwner: findOneBy returns null → short-circuits
    // leave's own findOneBy: also returns null → NotFoundException
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(null),
    });

    await expect(service.leave(CASE_ID, 'not-a-member')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── addMemberByEmail ──────────────────────────────────────────────────────────

describe('CasesService — addMemberByEmail', () => {
  let service: CasesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('throws NotFoundException when no user matches the email', async () => {
    mockUsersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.addMemberByEmail(CASE_ID, 'ghost@example.com', 'viewer'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockUsersService.findByEmail).toHaveBeenCalledWith('ghost@example.com');
  });

  it('calls addMember with resolved userId when user exists', async () => {
    const user = { id: 'user-123', email: 'alice@example.com' };
    const membership = makeMember(user.id, 'editor');

    mockUsersService.findByEmail.mockResolvedValue(user);
    // fetchOne inside addMember
    mockRepo.findOne.mockResolvedValue({ id: CASE_ID, investigations: [] });
    // no existing membership
    mockMemberRepo.findOneBy.mockResolvedValue(null);
    mockMemberRepo.create.mockReturnValue(membership);
    mockMemberRepo.save.mockResolvedValue(membership);

    const result = await service.addMemberByEmail(CASE_ID, 'alice@example.com', 'editor');

    expect(mockUsersService.findByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: user.id,
      role: 'editor',
    });
    expect(result).toEqual(membership);
  });

  it('trims and lowercases the email before lookup', async () => {
    mockUsersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.addMemberByEmail(CASE_ID, '  Alice@Example.COM  ', 'viewer'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockUsersService.findByEmail).toHaveBeenCalledWith('alice@example.com');
  });
});

// ── createWithOwner ───────────────────────────────────────────────────────────

describe('CasesService — createWithOwner', () => {
  let service: CasesService;
  const ORG_ID = 'org-1';
  const USER_ID = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('creates case and owner membership for a member-role user', async () => {
    const mockManager = {
      findOneBy: jest.fn()
        .mockResolvedValueOnce({ id: USER_ID, email: 'u@x.com' })
        .mockResolvedValueOnce({ id: ORG_ID, deletedAt: null })
        .mockResolvedValueOnce({ userId: USER_ID, organizationId: ORG_ID, role: 'member' }),
      create: jest.fn().mockImplementation((_, args) => ({ ...args })),
      save: jest.fn().mockImplementation((e) => Promise.resolve({ id: 'case-new', ...e })),
    };
    mockDataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

    await service.createWithOwner({ name: 'New Case', ownerUserId: USER_ID, orgId: ORG_ID });

    expect(mockManager.save).toHaveBeenCalledTimes(2);
  });

  it('throws ForbiddenException when user is not a member of the org', async () => {
    const mockManager = {
      findOneBy: jest.fn()
        .mockResolvedValueOnce({ id: USER_ID })
        .mockResolvedValueOnce({ id: ORG_ID, deletedAt: null })
        .mockResolvedValueOnce(null),
      create: jest.fn(),
      save: jest.fn(),
    };
    mockDataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

    await expect(
      service.createWithOwner({ name: 'New Case', ownerUserId: USER_ID, orgId: ORG_ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ForbiddenException when user is a guest in the org', async () => {
    const mockManager = {
      findOneBy: jest.fn()
        .mockResolvedValueOnce({ id: USER_ID })
        .mockResolvedValueOnce({ id: ORG_ID, deletedAt: null })
        .mockResolvedValueOnce({ userId: USER_ID, organizationId: ORG_ID, role: 'guest' }),
      create: jest.fn(),
      save: jest.fn(),
    };
    mockDataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

    await expect(
      service.createWithOwner({ name: 'New Case', ownerUserId: USER_ID, orgId: ORG_ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFoundException when the org is soft-deleted', async () => {
    const mockManager = {
      findOneBy: jest.fn()
        .mockResolvedValueOnce({ id: USER_ID })
        .mockResolvedValueOnce({ id: ORG_ID, deletedAt: new Date() }),
      create: jest.fn(),
      save: jest.fn(),
    };
    mockDataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

    await expect(
      service.createWithOwner({ name: 'New Case', ownerUserId: USER_ID, orgId: ORG_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when owner user not found', async () => {
    const mockManager = {
      findOneBy: jest.fn().mockResolvedValueOnce(null),
      create: jest.fn(),
      save: jest.fn(),
    };
    mockDataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

    await expect(
      service.createWithOwner({ name: 'New Case', ownerUserId: 'ghost', orgId: ORG_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ── findAllForUser ────────────────────────────────────────────────────────────

describe('CasesService — findAllForUser', () => {
  let service: CasesService;
  const ORG_ID = 'org-1';
  const USER_ID = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  function mockOrgAdminQuery(adminships: any[]) {
    mockOrgMemberRepo.createQueryBuilder = jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(adminships),
    });
  }

  it('returns cases from case_members for non-admin users', async () => {
    const cases = [{ id: 'c1', name: 'Case 1', createdAt: new Date(), organizationId: ORG_ID }];
    mockMemberRepo.find.mockResolvedValue(cases.map((c) => ({ case: c, role: 'viewer', userId: USER_ID })));
    mockOrgAdminQuery([]);

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    expect(result[0].role).toBe('viewer');
  });

  it('returns org admin cases with synthesized owner role', async () => {
    mockMemberRepo.find.mockResolvedValue([]);
    mockOrgAdminQuery([{ userId: USER_ID, organizationId: ORG_ID, role: 'admin' }]);
    const orgCase = { id: 'c2', name: 'Org Case', createdAt: new Date(), organizationId: ORG_ID };
    mockRepo.createQueryBuilder = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([orgCase]),
    });

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('owner');
  });

  it('deduplicates when user has both case_members row and is org admin', async () => {
    const sharedCase = { id: 'c1', name: 'Shared', createdAt: new Date(), organizationId: ORG_ID };
    mockMemberRepo.find.mockResolvedValue([{ case: sharedCase, role: 'editor', userId: USER_ID }]);
    mockOrgAdminQuery([{ userId: USER_ID, organizationId: ORG_ID, role: 'admin' }]);
    mockRepo.createQueryBuilder = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([sharedCase]),
    });

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('editor');
  });
});
