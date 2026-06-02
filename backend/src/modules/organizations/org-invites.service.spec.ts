import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { OrgInvitesService } from './org-invites.service';
import { OrganizationInviteEntity } from '../../database/entities/organization-invite.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-abc';
const ORG_SLUG = 'test-org';
const ORG_NAME = 'Test Org';
const INVITE_ID = 'invite-1';
const CREATOR_ID = 'user-creator';
const ACCEPTOR_FIREBASE_ID = 'firebase-acceptor';
const INVITE_CODE = 'ABCD1234abcd5678';
const INVITE_EMAIL = 'invitee@example.com';

const futureDate = () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const pastDate = () => new Date(Date.now() - 1000);

function makeInvite(overrides: Partial<OrganizationInviteEntity> = {}): OrganizationInviteEntity {
  return {
    id: INVITE_ID,
    organizationId: ORG_ID,
    email: INVITE_EMAIL,
    role: 'member',
    code: INVITE_CODE,
    message: null,
    createdByUserId: CREATOR_ID,
    expiresAt: futureDate(),
    usedAt: null,
    usedByUserId: null,
    organization: { id: ORG_ID, name: ORG_NAME, slug: ORG_SLUG, deletedAt: null } as any,
    createdBy: { id: CREATOR_ID, name: 'Alice' } as any,
    usedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OrganizationInviteEntity;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockQb = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockInviteRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb),
};

const mockMemberRepo = {
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockUserRepo = {
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockOrgRepo = {
  findOneBy: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn(),
};

function makeService(): OrgInvitesService {
  return new OrgInvitesService(
    mockInviteRepo as any,
    mockMemberRepo as any,
    mockUserRepo as any,
    mockOrgRepo as any,
    mockDataSource as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OrgInvitesService', () => {
  let service: OrgInvitesService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockInviteRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.leftJoinAndSelect.mockReturnThis();
    mockQb.where.mockReturnThis();
    mockQb.andWhere.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    service = makeService();
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    beforeEach(() => {
      mockInviteRepo.create.mockImplementation((args) => ({ ...args }));
      mockInviteRepo.save.mockImplementation((inv) => Promise.resolve({ id: INVITE_ID, ...inv }));
      mockUserRepo.create.mockImplementation((args) => ({ ...args }));
      mockUserRepo.save.mockResolvedValue({});
    });

    it('lowercases the email and generates a 16-char code', async () => {
      const dto = { email: 'Test@Example.COM', role: 'member' as const };
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'existing-user', email: 'test@example.com' });

      let capturedArgs: any;
      mockInviteRepo.create.mockImplementation((args) => {
        capturedArgs = args;
        return { ...args };
      });

      await service.create(ORG_ID, CREATOR_ID, dto);

      expect(capturedArgs.email).toBe('test@example.com');
      expect(capturedArgs.code).toHaveLength(16);
      expect(capturedArgs.organizationId).toBe(ORG_ID);
      expect(capturedArgs.createdByUserId).toBe(CREATOR_ID);
      expect(capturedArgs.role).toBe('member');
    });

    it('creates a shell user when none exists for the invite email', async () => {
      const dto = { email: 'new@example.com', role: 'guest' as const };
      mockUserRepo.findOneBy.mockResolvedValue(null);

      await service.create(ORG_ID, CREATOR_ID, dto);

      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com', name: 'new@example.com', firebaseUid: null }),
      );
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('skips shell-user creation when user already exists', async () => {
      const dto = { email: 'existing@example.com', role: 'member' as const };
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u-1', email: 'existing@example.com' });

      await service.create(ORG_ID, CREATOR_ID, dto);

      expect(mockUserRepo.create).not.toHaveBeenCalled();
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    it('sets message to null when omitted', async () => {
      const dto = { email: 'a@b.com', role: 'member' as const };
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u', email: 'a@b.com' });

      await service.create(ORG_ID, CREATOR_ID, dto);

      const capturedArgs = mockInviteRepo.create.mock.calls[0][0];
      expect(capturedArgs.message).toBeNull();
    });
  });

  // ── listPending ──────────────────────────────────────────────────────────────

  describe('listPending', () => {
    it('calls queryBuilder with orgId and usedAt IS NULL filters', async () => {
      const pending = [makeInvite()];
      mockQb.getMany.mockResolvedValue(pending);

      const result = await service.listPending(ORG_ID);

      expect(mockInviteRepo.createQueryBuilder).toHaveBeenCalledWith('invite');
      expect(mockQb.where).toHaveBeenCalledWith('invite.organizationId = :orgId', { orgId: ORG_ID });
      expect(mockQb.andWhere).toHaveBeenCalledWith('invite.usedAt IS NULL');
      expect(mockQb.andWhere).toHaveBeenCalledWith('invite.expiresAt > NOW()');
      expect(result).toEqual(pending);
    });

    it('returns empty array when queryBuilder returns nothing', async () => {
      mockQb.getMany.mockResolvedValue([]);
      const result = await service.listPending(ORG_ID);
      expect(result).toEqual([]);
    });
  });

  // ── revoke ───────────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('removes the invite if found and unused', async () => {
      const invite = makeInvite();
      mockInviteRepo.findOneBy.mockResolvedValue(invite);
      mockInviteRepo.remove.mockResolvedValue(undefined);

      await service.revoke(ORG_ID, INVITE_ID);

      expect(mockInviteRepo.findOneBy).toHaveBeenCalledWith({ id: INVITE_ID, organizationId: ORG_ID });
      expect(mockInviteRepo.remove).toHaveBeenCalledWith(invite);
    });

    it('throws NotFoundException when invite not found', async () => {
      mockInviteRepo.findOneBy.mockResolvedValue(null);

      await expect(service.revoke(ORG_ID, INVITE_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockInviteRepo.remove).not.toHaveBeenCalled();
    });

    it('throws ConflictException when invite already used', async () => {
      const invite = makeInvite({ usedAt: new Date() });
      mockInviteRepo.findOneBy.mockResolvedValue(invite);

      await expect(service.revoke(ORG_ID, INVITE_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(mockInviteRepo.remove).not.toHaveBeenCalled();
    });
  });

  // ── lookup ───────────────────────────────────────────────────────────────────

  describe('lookup', () => {
    it('returns status=pending with org and inviter info for a valid invite', async () => {
      const invite = makeInvite({ message: 'Join us!' });
      mockInviteRepo.findOne.mockResolvedValue(invite);

      const result = await service.lookup(INVITE_CODE);

      expect(result.status).toBe('pending');
      expect(result.orgName).toBe(ORG_NAME);
      expect(result.orgSlug).toBe(ORG_SLUG);
      expect(result.inviterName).toBe('Alice');
      expect(result.role).toBe('member');
      expect(result.email).toBe(INVITE_EMAIL);
      expect(result.message).toBe('Join us!');
    });

    it('returns status=revoked for an unknown code', async () => {
      mockInviteRepo.findOne.mockResolvedValue(null);

      const result = await service.lookup('unknown-code');

      expect(result.status).toBe('revoked');
      expect(result.orgName).toBeUndefined();
    });

    it('returns status=used when usedAt is set', async () => {
      const invite = makeInvite({ usedAt: new Date() });
      mockInviteRepo.findOne.mockResolvedValue(invite);

      const result = await service.lookup(INVITE_CODE);

      expect(result.status).toBe('used');
    });

    it('returns status=expired when expiresAt is in the past', async () => {
      const invite = makeInvite({ expiresAt: pastDate() });
      mockInviteRepo.findOne.mockResolvedValue(invite);

      const result = await service.lookup(INVITE_CODE);

      expect(result.status).toBe('expired');
    });
  });

  // ── accept ───────────────────────────────────────────────────────────────────

  describe('accept', () => {
    const mockOrg = { id: ORG_ID, name: ORG_NAME, slug: ORG_SLUG, deletedAt: null };

    function setupTransaction(invite: OrganizationInviteEntity | null, existingMember: OrganizationMemberEntity | null = null) {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(invite),
        // First call: find org by id; second call: find existing member
        findOneBy: jest.fn()
          .mockResolvedValueOnce(mockOrg)
          .mockResolvedValueOnce(existingMember),
        create: jest.fn().mockImplementation((_, args) => ({ ...args })),
        save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      };
      mockDataSource.transaction.mockImplementation((cb: (manager: any) => Promise<any>) => cb(mockManager));
      return mockManager;
    }

    it('happy path — creates org membership and marks invite as used', async () => {
      const invite = makeInvite();
      const mockManager = setupTransaction(invite, null);

      const result = await service.accept(INVITE_CODE, INVITE_EMAIL, ACCEPTOR_FIREBASE_ID);

      expect(result.orgSlug).toBe(ORG_SLUG);
      expect(result.alreadyMember).toBe(false);

      expect(mockManager.create).toHaveBeenCalledWith(OrganizationMemberEntity, {
        organizationId: ORG_ID,
        userId: ACCEPTOR_FIREBASE_ID,
        role: 'member',
      });
      expect(mockManager.save).toHaveBeenCalledTimes(2);

      expect(invite.usedAt).not.toBeNull();
      expect(invite.usedByUserId).toBe(ACCEPTOR_FIREBASE_ID);
    });

    it('email mismatch — throws ForbiddenException with email in message', async () => {
      const invite = makeInvite({ email: 'other@example.com' });
      setupTransaction(invite, null);

      await expect(
        service.accept(INVITE_CODE, 'wrong@example.com', ACCEPTOR_FIREBASE_ID),
      ).rejects.toMatchObject({
        constructor: ForbiddenException,
        message: expect.stringContaining('This invite is for'),
      });
    });

    it('already a member — returns alreadyMember=true and does NOT consume the invite', async () => {
      const invite = makeInvite();
      const existingMember = { id: 'mem-1', organizationId: ORG_ID, userId: ACCEPTOR_FIREBASE_ID } as any;
      const mockManager = setupTransaction(invite, existingMember);

      const result = await service.accept(INVITE_CODE, INVITE_EMAIL, ACCEPTOR_FIREBASE_ID);

      expect(result.alreadyMember).toBe(true);
      expect(result.orgSlug).toBe(ORG_SLUG);

      expect(invite.usedAt).toBeNull();
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('expired invite — throws GoneException', async () => {
      const invite = makeInvite({ expiresAt: pastDate() });
      setupTransaction(invite, null);

      await expect(
        service.accept(INVITE_CODE, INVITE_EMAIL, ACCEPTOR_FIREBASE_ID),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('already-used invite — throws GoneException', async () => {
      const invite = makeInvite({ usedAt: new Date() });
      setupTransaction(invite, null);

      await expect(
        service.accept(INVITE_CODE, INVITE_EMAIL, ACCEPTOR_FIREBASE_ID),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('unknown invite code — throws NotFoundException', async () => {
      setupTransaction(null, null);

      await expect(
        service.accept('bad-code', INVITE_EMAIL, ACCEPTOR_FIREBASE_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
