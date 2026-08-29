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

const mockOrgInvitesService = {
  findLiveInvite: jest.fn(),
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
  return new CasesService(
    mockRepo as any,
    mockMemberRepo as any,
    mockOrgMemberRepo as any,
    mockOrgInvitesService as any,
    mockDataSource as any,
    mockUsersService as any,
  );
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
//
// Org-scoping gate for granting a case seat by email: the target must belong to
// the case's org, either as an accepted organization_members row or as a live
// (unused, unexpired) organization_invites row. Everyone else gets a
// NotFoundException with an identical message, so a case owner cannot probe
// whether an address exists in some other org.
//
// The liveness check itself (unused, unexpired) is NOT this service's
// responsibility anymore — it's delegated to OrgInvitesService.findLiveInvite,
// the single place that expresses "live org invite" (see
// org-invites.service.spec.ts for the used/expired filtering tests). This
// suite only asserts CasesService's own wiring: it calls findLiveInvite with
// the right (orgId, email), trusts a truthy result, and 404s on null.

describe('CasesService — addMemberByEmail', () => {
  let service: CasesService;
  const ORG_ID = 'org-1';
  const OTHER_ORG_ID = 'org-2';

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
    // projection lookup — the case belongs to ORG_ID
    mockRepo.findOne.mockResolvedValue({ id: CASE_ID, orgId: ORG_ID, investigations: [] });
    // no live org invite unless a test seeds one
    mockOrgInvitesService.findLiveInvite.mockResolvedValue(null);
    // no existing case membership
    mockMemberRepo.findOneBy.mockResolvedValue(null);
  });

  /** The caller is an accepted member of `organizationId` (or of nothing when null). */
  function mockOrgMembership(organizationId: string | null) {
    mockOrgMemberRepo.findOneBy.mockImplementation(async (where: any) =>
      organizationId !== null && where.organizationId === organizationId ? { ...where, role: 'member' } : null,
    );
  }

  function makeOrgInvite(overrides: Record<string, any> = {}) {
    return {
      organizationId: ORG_ID,
      email: 'pending@example.com',
      role: 'member',
      usedAt: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  it('adds an accepted org member of the case org', async () => {
    const user = { id: 'user-123', email: 'alice@example.com' };
    const membership = makeMember(user.id, 'editor');
    mockUsersService.findByEmail.mockResolvedValue(user);
    mockOrgMembership(ORG_ID);
    mockMemberRepo.create.mockReturnValue(membership);
    mockMemberRepo.save.mockResolvedValue(membership);

    const result = await service.addMemberByEmail(CASE_ID, 'alice@example.com', 'editor');

    expect(mockUsersService.findByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(mockOrgMemberRepo.findOneBy).toHaveBeenCalledWith({
      userId: user.id,
      organizationId: ORG_ID,
    });
    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: user.id,
      role: 'editor',
    });
    expect(result).toEqual(membership);
  });

  it('adds a pending org invitee of the case org when OrgInvitesService reports a live invite', async () => {
    // Shell user row provisioned by OrgInvitesService.create — no firebaseUid yet.
    const shellUser = { id: 'user-shell', email: 'pending@example.com', firebaseUid: null };
    const membership = makeMember(shellUser.id, 'viewer');
    mockUsersService.findByEmail.mockResolvedValue(shellUser);
    mockOrgMembership(null);
    mockOrgInvitesService.findLiveInvite.mockResolvedValue(makeOrgInvite());
    mockMemberRepo.create.mockReturnValue(membership);
    mockMemberRepo.save.mockResolvedValue(membership);

    const result = await service.addMemberByEmail(CASE_ID, 'pending@example.com', 'viewer');

    expect(mockOrgInvitesService.findLiveInvite).toHaveBeenCalledWith(ORG_ID, 'pending@example.com');
    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      caseId: CASE_ID,
      userId: shellUser.id,
      role: 'viewer',
    });
    expect(result).toEqual(membership);
  });

  it('throws NotFoundException when OrgInvitesService reports no live invite for this org (e.g. user belongs to a different org)', async () => {
    const user = { id: 'user-outsider', email: 'mallory@other.com' };
    mockUsersService.findByEmail.mockResolvedValue(user);
    mockOrgMembership(OTHER_ORG_ID);
    // findLiveInvite is scoped to the CASE's org (ORG_ID), not OTHER_ORG_ID, so
    // even though a live invite may exist over there, this org sees none.
    mockOrgInvitesService.findLiveInvite.mockResolvedValue(null);

    await expect(
      service.addMemberByEmail(CASE_ID, 'mallory@other.com', 'viewer'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockOrgInvitesService.findLiveInvite).toHaveBeenCalledWith(ORG_ID, 'mallory@other.com');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no user matches the email', async () => {
    mockUsersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.addMemberByEmail(CASE_ID, 'ghost@example.com', 'viewer'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mockUsersService.findByEmail).toHaveBeenCalledWith('ghost@example.com');
    expect(mockMemberRepo.create).not.toHaveBeenCalled();
  });

  it('does not leak whether the email exists: same message for unknown and cross-org', async () => {
    mockUsersService.findByEmail.mockResolvedValue(null);
    const unknown = await service
      .addMemberByEmail(CASE_ID, 'ghost@example.com', 'viewer')
      .catch((e: Error) => e.message);

    jest.clearAllMocks();
    mockRepo.findOne.mockResolvedValue({ id: CASE_ID, orgId: ORG_ID, investigations: [] });
    mockOrgInvitesService.findLiveInvite.mockResolvedValue(null);
    mockUsersService.findByEmail.mockResolvedValue({ id: 'user-outsider', email: 'ghost@example.com' });
    mockOrgMembership(OTHER_ORG_ID);
    const crossOrg = await service
      .addMemberByEmail(CASE_ID, 'ghost@example.com', 'viewer')
      .catch((e: Error) => e.message);

    expect(crossOrg).toBe(unknown);
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

  function mockOrgMemberships(rows: Array<{ organizationId: string; role: 'admin' | 'member' | 'guest' }>) {
    mockOrgMemberRepo.createQueryBuilder = jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows.map((r) => ({ userId: USER_ID, ...r }))),
    });
  }

  function mockOrgCases(orgCases: any[]) {
    mockRepo.createQueryBuilder = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(orgCases),
    });
  }

  it('returns explicit case_members rows even when user has no current org memberships', async () => {
    const c1 = { id: 'c1', name: 'Case 1', createdAt: new Date(), orgId: ORG_ID };
    mockMemberRepo.find.mockResolvedValue([{ case: c1, role: 'viewer', userId: USER_ID }]);
    mockOrgMemberships([]);

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    expect(result[0].role).toBe('viewer');
  });

  it('synthesizes implicit owner role on every org case for org admins', async () => {
    mockMemberRepo.find.mockResolvedValue([]);
    mockOrgMemberships([{ organizationId: ORG_ID, role: 'admin' }]);
    const c1 = { id: 'c1', name: 'Org Case', createdAt: new Date(), orgId: ORG_ID };
    mockOrgCases([c1]);

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('owner');
  });

  it('synthesizes implicit editor role on every org case for org members', async () => {
    mockMemberRepo.find.mockResolvedValue([]);
    mockOrgMemberships([{ organizationId: ORG_ID, role: 'member' }]);
    const c1 = { id: 'c1', name: 'Org Case', createdAt: new Date(), orgId: ORG_ID };
    mockOrgCases([c1]);

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('editor');
  });

  it('lists org cases for guests but leaves role undefined when no explicit membership exists', async () => {
    mockMemberRepo.find.mockResolvedValue([]);
    mockOrgMemberships([{ organizationId: ORG_ID, role: 'guest' }]);
    const c1 = { id: 'c1', name: 'Ghosted Case', createdAt: new Date(), orgId: ORG_ID };
    mockOrgCases([c1]);

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
    expect(result[0].role).toBeUndefined();
  });

  it('guests with explicit case_members rows get the explicit role on those cases', async () => {
    const c1 = { id: 'c1', name: 'Invited Case', createdAt: new Date(), orgId: ORG_ID };
    const c2 = { id: 'c2', name: 'Ghost Case', createdAt: new Date(), orgId: ORG_ID };
    mockMemberRepo.find.mockResolvedValue([{ case: c1, role: 'viewer', userId: USER_ID }]);
    mockOrgMemberships([{ organizationId: ORG_ID, role: 'guest' }]);
    mockOrgCases([c1, c2]);

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(2);
    const byId = Object.fromEntries(result.map((r) => [r.id, r.role]));
    expect(byId.c1).toBe('viewer');
    expect(byId.c2).toBeUndefined();
  });

  it('explicit case_members role wins over implicit org role', async () => {
    const c1 = { id: 'c1', name: 'Shared', createdAt: new Date(), orgId: ORG_ID };
    mockMemberRepo.find.mockResolvedValue([{ case: c1, role: 'viewer', userId: USER_ID }]);
    mockOrgMemberships([{ organizationId: ORG_ID, role: 'admin' }]);
    mockOrgCases([c1]);

    const result = await service.findAllForUser({ id: USER_ID } as any);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('viewer');
  });
});

// ── findAllForUserInOrg ──────────────────────────────────────────────────────
//
// Used by the MCP `list_cases` tool: filters findAllForUser's result down to
// the principal's bound organizationId. This is the org-scoping gate for
// listing — cases in other orgs the user happens to belong to MUST NOT leak
// through an MCP session bound to a single org.

describe('CasesService — findAllForUserInOrg', () => {
  let service: CasesService;
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';
  const USER_ID = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  function mockOrgMemberships(rows: Array<{ organizationId: string; role: 'admin' | 'member' | 'guest' }>) {
    mockOrgMemberRepo.createQueryBuilder = jest.fn().mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows.map((r) => ({ userId: USER_ID, ...r }))),
    });
  }

  function mockOrgCases(orgCases: any[]) {
    mockRepo.createQueryBuilder = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(orgCases),
    });
  }

  it('returns only cases in the bound organization', async () => {
    const a1 = { id: 'a1', name: 'Org A Case', createdAt: new Date(), orgId: ORG_A };
    const b1 = { id: 'b1', name: 'Org B Case', createdAt: new Date(), orgId: ORG_B };
    mockMemberRepo.find.mockResolvedValue([]);
    mockOrgMemberships([
      { organizationId: ORG_A, role: 'admin' },
      { organizationId: ORG_B, role: 'admin' },
    ]);
    mockOrgCases([a1, b1]);

    const result = await service.findAllForUserInOrg({ id: USER_ID } as any, ORG_A);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
    expect(result[0].orgId).toBe(ORG_A);
  });

  it('returns empty array when user has cases only in other orgs', async () => {
    const b1 = { id: 'b1', name: 'Org B Case', createdAt: new Date(), orgId: ORG_B };
    mockMemberRepo.find.mockResolvedValue([]);
    mockOrgMemberships([{ organizationId: ORG_B, role: 'admin' }]);
    mockOrgCases([b1]);

    const result = await service.findAllForUserInOrg({ id: USER_ID } as any, ORG_A);

    expect(result).toHaveLength(0);
  });

  it('drops explicit-membership cases from other orgs (cross-org case_members rows do not leak)', async () => {
    // A user with an explicit case_members row on a case in org B should NOT
    // see that case through an MCP session bound to org A.
    const b1 = { id: 'b1', name: 'Org B Case', createdAt: new Date(), orgId: ORG_B };
    mockMemberRepo.find.mockResolvedValue([{ case: b1, role: 'viewer', userId: USER_ID }]);
    mockOrgMemberships([]);
    mockOrgCases([]);

    const result = await service.findAllForUserInOrg({ id: USER_ID } as any, ORG_A);

    expect(result).toHaveLength(0);
  });

  it('preserves the per-case role from findAllForUser', async () => {
    const a1 = { id: 'a1', name: 'Org A Case', createdAt: new Date(), orgId: ORG_A };
    mockMemberRepo.find.mockResolvedValue([]);
    mockOrgMemberships([{ organizationId: ORG_A, role: 'member' }]);
    mockOrgCases([a1]);

    const result = await service.findAllForUserInOrg({ id: USER_ID } as any, ORG_A);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('editor');
  });
});
