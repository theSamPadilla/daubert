import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SuperadminOrgsService } from './superadmin-orgs.service';
import { OrganizationEntity } from '../../../database/entities/organization.entity';
import { OrganizationMemberEntity } from '../../../database/entities/organization-member.entity';
import { UserEntity } from '../../../database/entities/user.entity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const ADMIN_EMAIL = 'admin@example.com';

function makeOrg(overrides: Partial<OrganizationEntity> = {}): OrganizationEntity {
  return {
    id: ORG_ID,
    name: 'Acme',
    slug: 'acme',
    deletedAt: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    members: [],
    cases: [],
    ...overrides,
  } as OrganizationEntity;
}

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: USER_ID,
    email: ADMIN_EMAIL,
    name: ADMIN_EMAIL,
    firebaseUid: null,
    avatarUrl: null,
    isSuperAdmin: false,
    ...overrides,
  } as UserEntity;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockOrgRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  countBy: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  create: jest.fn(),
};

const mockMemberRepo = {
  countBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockUserRepo = {
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockCaseRepo = {
  countBy: jest.fn(),
};

const mockManager = {
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn((cb: (m: typeof mockManager) => Promise<any>) => cb(mockManager)),
};

// ── Helper ────────────────────────────────────────────────────────────────────

function makeService(): SuperadminOrgsService {
  return new SuperadminOrgsService(
    mockOrgRepo as any,
    mockMemberRepo as any,
    mockUserRepo as any,
    mockCaseRepo as any,
    mockDataSource as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuperadminOrgsService', () => {
  let service: SuperadminOrgsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  // ── createWithFirstAdmin ───────────────────────────────────────────────────

  describe('createWithFirstAdmin', () => {
    beforeEach(() => {
      mockOrgRepo.findOneBy.mockResolvedValue(null); // no slug collision by default
    });

    it('creates org + admin row for an existing user', async () => {
      const savedOrg = makeOrg();
      const existingUser = makeUser();

      mockManager.create.mockImplementation((_, args) => ({ ...args }));
      mockManager.findOneBy.mockResolvedValue(existingUser);
      mockManager.save
        .mockResolvedValueOnce(savedOrg)    // org save
        .mockResolvedValueOnce({ organizationId: ORG_ID, userId: USER_ID, role: 'admin' }) // member save
        .mockResolvedValue({}); // fallback

      await service.createWithFirstAdmin({ name: 'Acme', firstAdminEmail: ADMIN_EMAIL });

      const createCalls = mockManager.create.mock.calls;
      const memberCreateCall = createCalls.find((call) => call[1]?.role === 'admin');
      expect(memberCreateCall).toBeDefined();
      expect(memberCreateCall![1].userId).toBe(USER_ID);
    });

    it('creates a shell user when email does not match an existing user', async () => {
      const savedOrg = makeOrg();
      const newUser = makeUser({ id: 'new-user', email: 'new@example.com', name: 'new@example.com', firebaseUid: null });

      mockManager.create.mockImplementation((_, args) => ({ ...args }));
      mockManager.findOneBy.mockResolvedValue(null); // no existing user
      mockManager.save
        .mockResolvedValueOnce(savedOrg)    // org save
        .mockResolvedValueOnce(newUser)     // shell user save
        .mockResolvedValue({});             // member save

      await service.createWithFirstAdmin({ name: 'Acme', firstAdminEmail: 'new@example.com' });

      const createCalls = mockManager.create.mock.calls;
      const userCreateCall = createCalls.find(
        (call) => call[1]?.email === 'new@example.com' && call[1]?.firebaseUid === null,
      );
      expect(userCreateCall).toBeDefined();
    });

    it('derives slug from name when not provided', async () => {
      const savedOrg = makeOrg({ name: 'My Cool Org', slug: 'my-cool-org' });
      mockManager.create.mockImplementation((_, args) => ({ ...args }));
      mockManager.findOneBy.mockResolvedValue(makeUser());
      mockManager.save.mockResolvedValue(savedOrg);

      await service.createWithFirstAdmin({ name: 'My Cool Org', firstAdminEmail: ADMIN_EMAIL });

      const createCalls = mockManager.create.mock.calls;
      const orgCreateCall = createCalls.find((call) => call[1]?.name === 'My Cool Org');
      expect(orgCreateCall![1].slug).toBe('my-cool-org');
    });

    it('appends -2 suffix when slug already taken, -3 when -2 also taken', async () => {
      mockOrgRepo.findOneBy
        .mockResolvedValueOnce(makeOrg({ slug: 'acme' }))   // 'acme' taken
        .mockResolvedValueOnce(makeOrg({ slug: 'acme-2' })) // 'acme-2' taken
        .mockResolvedValueOnce(null);                        // 'acme-3' free

      mockManager.create.mockImplementation((_, args) => ({ ...args }));
      mockManager.findOneBy.mockResolvedValue(makeUser());
      mockManager.save.mockResolvedValue(makeOrg({ slug: 'acme-3' }));

      await service.createWithFirstAdmin({ name: 'Acme', firstAdminEmail: ADMIN_EMAIL });

      const createCalls = mockManager.create.mock.calls;
      const orgCreateCall = createCalls.find((call) => call[1]?.name === 'Acme');
      expect(orgCreateCall![1].slug).toBe('acme-3');
    });

    it('uses the provided slug directly when given', async () => {
      mockManager.create.mockImplementation((_, args) => ({ ...args }));
      mockManager.findOneBy.mockResolvedValue(makeUser());
      mockManager.save.mockResolvedValue(makeOrg({ slug: 'custom-slug' }));

      await service.createWithFirstAdmin({ name: 'Acme', slug: 'custom-slug', firstAdminEmail: ADMIN_EMAIL });

      const createCalls = mockManager.create.mock.calls;
      const orgCreateCall = createCalls.find((call) => call[1]?.name === 'Acme');
      expect(orgCreateCall![1].slug).toBe('custom-slug');
    });
  });

  // ── softDelete ─────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('sets deletedAt on an active org', async () => {
      const org = makeOrg();
      mockOrgRepo.findOneBy.mockResolvedValue(org);
      mockOrgRepo.save.mockImplementation((o) => Promise.resolve(o));

      await service.softDelete(ORG_ID);

      expect(org.deletedAt).not.toBeNull();
      expect(mockOrgRepo.save).toHaveBeenCalledWith(org);
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockOrgRepo.findOneBy.mockResolvedValue(null);
      await expect(service.softDelete(ORG_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when org is already soft-deleted', async () => {
      const org = makeOrg({ deletedAt: new Date() });
      mockOrgRepo.findOneBy.mockResolvedValue(org);
      await expect(service.softDelete(ORG_ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── restore ────────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('clears deletedAt on a soft-deleted org', async () => {
      const org = makeOrg({ deletedAt: new Date() });
      mockOrgRepo.findOneBy.mockResolvedValue(org);
      mockOrgRepo.save.mockImplementation((o) => Promise.resolve(o));

      await service.restore(ORG_ID);

      expect(org.deletedAt).toBeNull();
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockOrgRepo.findOneBy.mockResolvedValue(null);
      await expect(service.restore(ORG_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when org is not soft-deleted', async () => {
      const org = makeOrg({ deletedAt: null });
      mockOrgRepo.findOneBy.mockResolvedValue(org);
      await expect(service.restore(ORG_ID)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── purge ──────────────────────────────────────────────────────────────────

  describe('purge', () => {
    it('hard-deletes an org that has been soft-deleted for > 30 days', async () => {
      const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const org = makeOrg({ deletedAt: longAgo });
      mockOrgRepo.findOneBy.mockResolvedValue(org);
      mockOrgRepo.remove.mockResolvedValue(undefined);

      await service.purge(ORG_ID);

      expect(mockOrgRepo.remove).toHaveBeenCalledWith(org);
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockOrgRepo.findOneBy.mockResolvedValue(null);
      await expect(service.purge(ORG_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when org is not soft-deleted', async () => {
      const org = makeOrg({ deletedAt: null });
      mockOrgRepo.findOneBy.mockResolvedValue(org);
      await expect(service.purge(ORG_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when soft-deleted less than 30 days ago', async () => {
      const recentlyDeleted = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const org = makeOrg({ deletedAt: recentlyDeleted });
      mockOrgRepo.findOneBy.mockResolvedValue(org);
      await expect(service.purge(ORG_ID)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
