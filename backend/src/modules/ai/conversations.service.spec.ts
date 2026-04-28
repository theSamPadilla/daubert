import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockConversationRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

const mockMessageRepo = {
  find: jest.fn(),
};

const mockMemberRepo = {
  findOneBy: jest.fn(),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = 'case-1';
const USER_ID = 'user-1';
const OTHER_USER_ID = 'someoneElse';
const CONV_ID = 'conv-1';

const membership = { userId: USER_ID, caseId: CASE_ID, role: 'editor' };

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('ConversationsService', () => {
  let service: ConversationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationsService,
        {
          provide: getRepositoryToken(ConversationEntity),
          useValue: mockConversationRepo,
        },
        {
          provide: getRepositoryToken(MessageEntity),
          useValue: mockMessageRepo,
        },
        {
          provide: getRepositoryToken(CaseMemberEntity),
          useValue: mockMemberRepo,
        },
      ],
    }).compile();

    service = module.get<ConversationsService>(ConversationsService);
  });

  // ── 1. create writes both keys ─────────────────────────────────────────────

  describe('create', () => {
    it('writes both caseId and userId on the saved entity', async () => {
      // assertCaseMembership passes
      mockMemberRepo.findOneBy.mockResolvedValue(membership);

      // create() returns the entity it built; save() returns it back
      mockConversationRepo.create.mockImplementation((data) => data);
      mockConversationRepo.save.mockImplementation(async (entity) => entity);

      const result = await service.create(CASE_ID, USER_ID);

      expect(mockMemberRepo.findOneBy).toHaveBeenCalledWith({
        userId: USER_ID,
        caseId: CASE_ID,
      });
      expect(mockConversationRepo.create).toHaveBeenCalledWith({
        caseId: CASE_ID,
        userId: USER_ID,
        title: null,
      });
      expect(mockConversationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ caseId: CASE_ID, userId: USER_ID }),
      );
      expect(result).toEqual(
        expect.objectContaining({ caseId: CASE_ID, userId: USER_ID }),
      );
    });

    it('throws ForbiddenException when caller is not a case member', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create(CASE_ID, USER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockConversationRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── 2. findAllForUserInCase filters on BOTH keys ───────────────────────────

  describe('findAllForUserInCase', () => {
    it('filters on both caseId AND userId, asserts membership first', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(membership);
      mockConversationRepo.find.mockResolvedValue([]);

      await service.findAllForUserInCase(CASE_ID, USER_ID);

      // Membership check happened
      expect(mockMemberRepo.findOneBy).toHaveBeenCalledWith({
        userId: USER_ID,
        caseId: CASE_ID,
      });

      // And it happened BEFORE the find()
      const memberCallOrder =
        mockMemberRepo.findOneBy.mock.invocationCallOrder[0];
      const findCallOrder = mockConversationRepo.find.mock.invocationCallOrder[0];
      expect(memberCallOrder).toBeLessThan(findCallOrder);

      // The find clause MUST contain both keys — guests sharing a case must not
      // see the conversation owner's threads.
      expect(mockConversationRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { caseId: CASE_ID, userId: USER_ID },
        }),
      );
    });

    it('throws ForbiddenException when caller is not a case member (find never called)', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.findAllForUserInCase(CASE_ID, USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockConversationRepo.find).not.toHaveBeenCalled();
    });
  });

  // ── 3. findOne enforces ownership ──────────────────────────────────────────

  describe('findOne', () => {
    it("throws ForbiddenException('Not your conversation') when requester is a case member but NOT the owner", async () => {
      // Conversation owned by someone else, but in a case the caller belongs to.
      mockConversationRepo.findOneBy.mockResolvedValue({
        id: CONV_ID,
        caseId: CASE_ID,
        userId: OTHER_USER_ID,
      });
      // Case membership lookup PASSES — proves the rejection is on userId, not membership.
      mockMemberRepo.findOneBy.mockResolvedValue(membership);

      await expect(service.findOne(CONV_ID, USER_ID)).rejects.toThrow(
        'Not your conversation',
      );
      await expect(service.findOne(CONV_ID, USER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      mockConversationRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(CONV_ID, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the conversation and re-checks case membership (defense-in-depth) when owner matches', async () => {
      const conv = { id: CONV_ID, caseId: CASE_ID, userId: USER_ID };
      mockConversationRepo.findOneBy.mockResolvedValue(conv);
      mockMemberRepo.findOneBy.mockResolvedValue(membership);

      const result = await service.findOne(CONV_ID, USER_ID);

      expect(result).toBe(conv);
      // Bonus: membership was re-checked AFTER the userId match passed.
      expect(mockMemberRepo.findOneBy).toHaveBeenCalledWith({
        userId: USER_ID,
        caseId: CASE_ID,
      });
    });

    it('throws ForbiddenException if owner matches but user has been removed from the case', async () => {
      mockConversationRepo.findOneBy.mockResolvedValue({
        id: CONV_ID,
        caseId: CASE_ID,
        userId: USER_ID,
      });
      // Membership was revoked since the conversation was created.
      mockMemberRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne(CONV_ID, USER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ── 4. getMessages and delete inherit ownership enforcement ────────────────

  describe('ownership enforcement is inherited', () => {
    it('getMessages propagates ForbiddenException from findOne', async () => {
      // Stub findOne directly — simplest way to prove pass-through.
      jest
        .spyOn(service, 'findOne')
        .mockRejectedValue(new ForbiddenException('Not your conversation'));

      await expect(
        service.getMessages(CONV_ID, USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.findOne).toHaveBeenCalledWith(CONV_ID, USER_ID);
      expect(mockMessageRepo.find).not.toHaveBeenCalled();
    });

    it('delete propagates ForbiddenException from findOne', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockRejectedValue(new ForbiddenException('Not your conversation'));

      await expect(service.delete(CONV_ID, USER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(service.findOne).toHaveBeenCalledWith(CONV_ID, USER_ID);
      expect(mockConversationRepo.remove).not.toHaveBeenCalled();
    });
  });
});
