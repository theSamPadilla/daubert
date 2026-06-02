import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InvitesService } from './invites.service';
import { CaseInviteEntity } from '../../database/entities/case-invite.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CASE_ID = 'case-abc';
const INVITE_ID = 'invite-1';
const CREATOR_ID = 'user-creator';
const ACCEPTOR_FIREBASE_ID = 'firebase-acceptor';
const INVITE_CODE = 'ABCD1234abcd5678';
const INVITE_EMAIL = 'invitee@example.com';

const futureDate = () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const pastDate = () => new Date(Date.now() - 1000);

function makeInvite(overrides: Partial<CaseInviteEntity> = {}): CaseInviteEntity {
  return {
    id: INVITE_ID,
    caseId: CASE_ID,
    email: INVITE_EMAIL,
    role: 'editor',
    code: INVITE_CODE,
    message: null,
    createdByUserId: CREATOR_ID,
    expiresAt: futureDate(),
    usedAt: null,
    usedByUserId: null,
    case: { id: CASE_ID, name: 'Test Case' } as any,
    createdBy: { id: CREATOR_ID, name: 'Alice' } as any,
    usedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CaseInviteEntity;
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

const mockDataSource = {
  transaction: jest.fn(),
};

// ── Helper ────────────────────────────────────────────────────────────────────

function makeService(): InvitesService {
  return new InvitesService(
    mockInviteRepo as any,
    mockMemberRepo as any,
    mockUserRepo as any,
    mockDataSource as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InvitesService', () => {
  let service: InvitesService;

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
      const dto = { email: 'Test@Example.COM', role: 'editor' as const };
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'existing-user', email: 'test@example.com' });

      let capturedArgs: any;
      mockInviteRepo.create.mockImplementation((args) => {
        capturedArgs = args;
        return { ...args };
      });

      await service.create(CASE_ID, CREATOR_ID, dto);

      expect(capturedArgs.email).toBe('test@example.com');
      expect(capturedArgs.code).toHaveLength(16);
      expect(capturedArgs.caseId).toBe(CASE_ID);
      expect(capturedArgs.createdByUserId).toBe(CREATOR_ID);
      expect(capturedArgs.role).toBe('editor');
    });

    it('creates a shell user when none exists for the invite email', async () => {
      const dto = { email: 'new@example.com', role: 'viewer' as const };
      mockUserRepo.findOneBy.mockResolvedValue(null);

      await service.create(CASE_ID, CREATOR_ID, dto);

      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com', name: 'new@example.com', firebaseUid: null }),
      );
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('skips shell-user creation when user already exists', async () => {
      const dto = { email: 'existing@example.com', role: 'editor' as const };
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u-1', email: 'existing@example.com' });

      await service.create(CASE_ID, CREATOR_ID, dto);

      expect(mockUserRepo.create).not.toHaveBeenCalled();
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    it('recovers gracefully when shell-user create hits a unique constraint', async () => {
      const dto = { email: 'race@example.com', role: 'viewer' as const };
      // First findOneBy returns null (no user yet), then save throws, then re-fetch returns user
      mockUserRepo.findOneBy
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'u-race', email: 'race@example.com' });
      mockUserRepo.save.mockRejectedValueOnce(new Error('duplicate key value'));

      // Should NOT throw — invite creation continues after unique-constraint recovery
      await expect(service.create(CASE_ID, CREATOR_ID, dto)).resolves.toBeDefined();
    });

    it('sets expiresAt ~14 days from now', async () => {
      const before = Date.now();
      const dto = { email: 'a@b.com', role: 'viewer' as const };
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u', email: 'a@b.com' });

      await service.create(CASE_ID, CREATOR_ID, dto);

      const after = Date.now();
      const expectedMs = 14 * 24 * 60 * 60 * 1000;
      const capturedExpiry = (mockInviteRepo.create.mock.calls[0][0] as any).expiresAt as Date;
      const expiryTs = capturedExpiry.getTime();

      // Allow 1s tolerance for the test runner
      expect(expiryTs).toBeGreaterThanOrEqual(before + expectedMs - 1000);
      expect(expiryTs).toBeLessThanOrEqual(after + expectedMs + 1000);
    });

    it('sets message to null when omitted', async () => {
      const dto = { email: 'a@b.com', role: 'viewer' as const };
      mockUserRepo.findOneBy.mockResolvedValue({ id: 'u', email: 'a@b.com' });

      await service.create(CASE_ID, CREATOR_ID, dto);

      const capturedArgs = mockInviteRepo.create.mock.calls[0][0];
      expect(capturedArgs.message).toBeNull();
    });
  });

  // ── listPending ──────────────────────────────────────────────────────────────

  describe('listPending', () => {
    it('calls queryBuilder with caseId and usedAt IS NULL filters', async () => {
      const pending = [makeInvite()];
      mockQb.getMany.mockResolvedValue(pending);

      const result = await service.listPending(CASE_ID);

      expect(mockInviteRepo.createQueryBuilder).toHaveBeenCalledWith('invite');
      expect(mockQb.where).toHaveBeenCalledWith('invite.caseId = :caseId', { caseId: CASE_ID });
      expect(mockQb.andWhere).toHaveBeenCalledWith('invite.usedAt IS NULL');
      expect(mockQb.andWhere).toHaveBeenCalledWith('invite.expiresAt > NOW()');
      expect(result).toEqual(pending);
    });

    it('returns empty array when queryBuilder returns nothing', async () => {
      mockQb.getMany.mockResolvedValue([]);
      const result = await service.listPending(CASE_ID);
      expect(result).toEqual([]);
    });
  });

  // ── revoke ───────────────────────────────────────────────────────────────────

  describe('revoke', () => {
    it('removes the invite if found and unused', async () => {
      const invite = makeInvite();
      mockInviteRepo.findOneBy.mockResolvedValue(invite);
      mockInviteRepo.remove.mockResolvedValue(undefined);

      await service.revoke(CASE_ID, INVITE_ID);

      expect(mockInviteRepo.findOneBy).toHaveBeenCalledWith({ id: INVITE_ID, caseId: CASE_ID });
      expect(mockInviteRepo.remove).toHaveBeenCalledWith(invite);
    });

    it('throws NotFoundException when invite not found', async () => {
      mockInviteRepo.findOneBy.mockResolvedValue(null);

      await expect(service.revoke(CASE_ID, INVITE_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockInviteRepo.remove).not.toHaveBeenCalled();
    });

    it('throws ConflictException when invite already used', async () => {
      const invite = makeInvite({ usedAt: new Date() });
      mockInviteRepo.findOneBy.mockResolvedValue(invite);

      await expect(service.revoke(CASE_ID, INVITE_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(mockInviteRepo.remove).not.toHaveBeenCalled();
    });
  });

  // ── lookup ───────────────────────────────────────────────────────────────────

  describe('lookup', () => {
    it('returns status=pending with case and inviter info for a valid invite', async () => {
      const invite = makeInvite({ message: 'Join us!' });
      mockInviteRepo.findOne.mockResolvedValue(invite);

      const result = await service.lookup(INVITE_CODE);

      expect(result.status).toBe('pending');
      expect(result.caseName).toBe('Test Case');
      expect(result.inviterName).toBe('Alice');
      expect(result.role).toBe('editor');
      expect(result.email).toBe(INVITE_EMAIL);
      expect(result.message).toBe('Join us!');
    });

    it('returns status=revoked for an unknown code', async () => {
      mockInviteRepo.findOne.mockResolvedValue(null);

      const result = await service.lookup('unknown-code');

      expect(result.status).toBe('revoked');
      expect(result.caseName).toBeUndefined();
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
    /**
     * Helper: wire up dataSource.transaction to call the callback with a mock
     * entity manager, then assert on the manager's calls.
     */
    function setupTransaction(invite: CaseInviteEntity | null, existingMember: CaseMemberEntity | null = null) {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(invite),
        findOneBy: jest.fn().mockResolvedValue(existingMember),
        create: jest.fn().mockImplementation((_, args) => ({ ...args })),
        save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      };
      mockDataSource.transaction.mockImplementation((cb: (manager: any) => Promise<any>) => cb(mockManager));
      return mockManager;
    }

    it('happy path — creates membership and marks invite as used', async () => {
      const invite = makeInvite();
      const mockManager = setupTransaction(invite, null);

      const result = await service.accept(INVITE_CODE, INVITE_EMAIL, ACCEPTOR_FIREBASE_ID);

      expect(result.caseId).toBe(CASE_ID);
      expect(result.alreadyMember).toBe(false);

      // Membership was created
      expect(mockManager.create).toHaveBeenCalledWith(CaseMemberEntity, {
        caseId: CASE_ID,
        userId: ACCEPTOR_FIREBASE_ID,
        role: 'editor',
      });
      expect(mockManager.save).toHaveBeenCalledTimes(2); // membership + invite

      // Invite was marked used
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
      const existingMember = { id: 'mem-1', caseId: CASE_ID, userId: ACCEPTOR_FIREBASE_ID } as any;
      const mockManager = setupTransaction(invite, existingMember);

      const result = await service.accept(INVITE_CODE, INVITE_EMAIL, ACCEPTOR_FIREBASE_ID);

      expect(result.alreadyMember).toBe(true);
      expect(result.caseId).toBe(CASE_ID);

      // Invite must NOT be consumed — usedAt stays null
      expect(invite.usedAt).toBeNull();
      // save should not have been called (no membership or invite update)
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

    it('regression: case invite accept does NOT create an organization_members row', async () => {
      // Case belongs to an org (org-uuid). User accepts a case invite.
      // No OrganizationMemberEntity row must be created — case membership is
      // independent of org membership (product decision #4).
      const invite = makeInvite();
      const mockManager = setupTransaction(invite, null);

      await service.accept(INVITE_CODE, INVITE_EMAIL, ACCEPTOR_FIREBASE_ID);

      // Verify that manager.create was never called with OrganizationMemberEntity
      const createCallsWithOrgMember = mockManager.create.mock.calls.filter(
        (call) => call[0] === OrganizationMemberEntity,
      );
      expect(createCallsWithOrgMember).toHaveLength(0);

      // Verify only the CaseMemberEntity row was created
      const caseMemCreateCalls = mockManager.create.mock.calls.filter(
        (call) => call[0] === CaseMemberEntity,
      );
      expect(caseMemCreateCalls).toHaveLength(1);
    });
  });
});
