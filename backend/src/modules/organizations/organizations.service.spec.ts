import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrgRole } from '../../database/entities/organization-member.entity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const ORG_SLUG = 'test-org';
const USER_A = 'user-admin';
const USER_B = 'user-member';
const USER_C = 'user-guest';
const USER_NEW = 'user-new';

function makeOrg(overrides: any = {}) {
  return { id: ORG_ID, name: 'Test Org', slug: ORG_SLUG, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides };
}

function makeMember(userId: string, role: OrgRole) {
  return { id: `m-${userId}`, userId, organizationId: ORG_ID, role, user: makeUser(userId), createdAt: new Date(), updatedAt: new Date() };
}

function makeUser(id: string) {
  return { id, email: `${id}@example.com`, name: id, avatarUrl: null, firebaseUid: `firebase-${id}`, createdAt: new Date(), updatedAt: new Date() };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockOrgRepo = {
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockMemberRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockUsersService = {
  findByEmail: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn(),
};

function makeService() {
  return new OrganizationsService(
    mockOrgRepo as any,
    mockMemberRepo as any,
    mockUsersService as any,
    mockDataSource as any,
  );
}

function setupTransaction(managerOverrides: Partial<{
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  count: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  create: jest.Mock;
}> = {}) {
  const mockManager = {
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    remove: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation((_, args) => ({ ...args })),
    ...managerOverrides,
  };
  mockDataSource.transaction.mockImplementation((cb: (m: any) => Promise<any>) => cb(mockManager));
  return mockManager;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrganizationsService — findBySlug', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('returns org when found and not deleted', async () => {
    const org = makeOrg();
    mockOrgRepo.findOneBy.mockResolvedValue(org);

    const result = await service.findBySlug(ORG_SLUG);

    expect(result).toEqual(org);
    expect(mockOrgRepo.findOneBy).toHaveBeenCalledWith({ slug: ORG_SLUG, deletedAt: expect.anything() });
  });

  it('throws NotFoundException when org not found', async () => {
    mockOrgRepo.findOneBy.mockResolvedValue(null);

    await expect(service.findBySlug('no-org')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrganizationsService — update', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('updates name when provided', async () => {
    const org = makeOrg();
    mockOrgRepo.findOneBy.mockResolvedValue(org);
    mockOrgRepo.save.mockImplementation((o) => Promise.resolve(o));

    const result = await service.update(ORG_ID, { name: 'New Name' });

    expect(result.name).toBe('New Name');
    expect(mockOrgRepo.save).toHaveBeenCalled();
  });

  it('updates slug when provided and unique', async () => {
    const org = makeOrg();
    mockOrgRepo.findOneBy
      .mockResolvedValueOnce(org)
      .mockResolvedValueOnce(null);
    mockOrgRepo.save.mockImplementation((o) => Promise.resolve(o));

    const result = await service.update(ORG_ID, { slug: 'new-slug' });

    expect(result.slug).toBe('new-slug');
  });

  it('throws ConflictException when new slug is taken by another org', async () => {
    const org = makeOrg();
    const conflictOrg = makeOrg({ id: 'other-org', slug: 'taken-slug' });
    mockOrgRepo.findOneBy
      .mockResolvedValueOnce(org)
      .mockResolvedValueOnce(conflictOrg);

    await expect(service.update(ORG_ID, { slug: 'taken-slug' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows keeping the same slug (no conflict)', async () => {
    const org = makeOrg();
    mockOrgRepo.findOneBy
      .mockResolvedValueOnce(org)
      .mockResolvedValueOnce(org);
    mockOrgRepo.save.mockImplementation((o) => Promise.resolve(o));

    const result = await service.update(ORG_ID, { slug: ORG_SLUG });

    expect(result.slug).toBe(ORG_SLUG);
  });
});

describe('OrganizationsService — listMembers', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('returns members with user info shape', async () => {
    const members = [makeMember(USER_A, 'admin'), makeMember(USER_B, 'member')];
    mockMemberRepo.find.mockResolvedValue(members);

    const result = await service.listMembers(ORG_ID);

    expect(result).toHaveLength(2);
    expect(result[0].userId).toBe(USER_A);
    expect(result[0].role).toBe('admin');
    expect(result[0].user).toMatchObject({ id: USER_A, email: `${USER_A}@example.com` });
    expect((result[0] as any).orgRole).toBeUndefined();
  });

  it('returns empty array when org has no members', async () => {
    mockMemberRepo.find.mockResolvedValue([]);

    const result = await service.listMembers(ORG_ID);

    expect(result).toEqual([]);
  });
});

describe('OrganizationsService — addMemberByEmail', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('adds user as member when user exists and not already a member', async () => {
    const user = makeUser(USER_NEW);
    mockUsersService.findByEmail.mockResolvedValue(user);
    mockMemberRepo.findOneBy.mockResolvedValue(null);
    mockMemberRepo.create.mockImplementation((args) => ({ ...args }));
    mockMemberRepo.save.mockImplementation((m) => Promise.resolve({ id: 'm-new', ...m }));

    const result = await service.addMemberByEmail(ORG_ID, `${USER_NEW}@example.com`, 'member');

    expect(result).toMatchObject({ userId: USER_NEW, organizationId: ORG_ID, role: 'member' });
  });

  it('throws NotFoundException when user not found', async () => {
    mockUsersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.addMemberByEmail(ORG_ID, 'ghost@example.com', 'member'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when user already a member', async () => {
    const user = makeUser(USER_B);
    mockUsersService.findByEmail.mockResolvedValue(user);
    mockMemberRepo.findOneBy.mockResolvedValue(makeMember(USER_B, 'member'));

    await expect(
      service.addMemberByEmail(ORG_ID, `${USER_B}@example.com`, 'member'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OrganizationsService — updateMemberRole', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('updates role successfully', async () => {
    const member = makeMember(USER_B, 'member');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(2),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'admin' });

    const result = await service.updateMemberRole(ORG_ID, USER_B, 'admin');

    expect(result.role).toBe('admin');
  });

  it('throws ConflictException when demoting the only admin', async () => {
    const member = makeMember(USER_A, 'admin');
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(1),
    });

    await expect(service.updateMemberRole(ORG_ID, USER_A, 'member')).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses a pessimistic lock on the org row', async () => {
    const member = makeMember(USER_B, 'member');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(2),
    });
    mgr.save.mockResolvedValue({ ...member, role: 'admin' });

    await service.updateMemberRole(ORG_ID, USER_B, 'admin');

    expect(mgr.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });
});

describe('OrganizationsService — removeMember', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('removes member successfully', async () => {
    const member = makeMember(USER_B, 'member');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(1),
    });

    await service.removeMember(ORG_ID, USER_B);

    expect(mgr.remove).toHaveBeenCalledWith(member);
  });

  it('throws ConflictException when removing the only admin', async () => {
    const member = makeMember(USER_A, 'admin');
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(1),
    });

    await expect(service.removeMember(ORG_ID, USER_A)).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when member not found', async () => {
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(null),
    });

    await expect(service.removeMember(ORG_ID, 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrganizationsService — leave', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  it('allows a member to self-remove', async () => {
    const member = makeMember(USER_B, 'member');
    const mgr = setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
    });

    await service.leave(ORG_ID, USER_B);

    expect(mgr.remove).toHaveBeenCalledWith(member);
  });

  it('throws ConflictException when last admin tries to leave', async () => {
    const member = makeMember(USER_A, 'admin');
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(member),
      count: jest.fn().mockResolvedValue(1),
    });

    await expect(service.leave(ORG_ID, USER_A)).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when user is not a member', async () => {
    setupTransaction({
      findOneBy: jest.fn().mockResolvedValue(null),
    });

    await expect(service.leave(ORG_ID, 'not-a-member')).rejects.toBeInstanceOf(NotFoundException);
  });
});
