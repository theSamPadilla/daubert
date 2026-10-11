import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadGatewayException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationEntity } from '../../database/entities/conversation.entity';
import { MessageEntity } from '../../database/entities/message.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { AgentRunEntity } from '../../database/entities/agent-run.entity';
import { ConversationSummaryService } from './conversation-summary.service';
import { CaseAccessService } from '../auth/case-access.service';
import { TOOL_RESULT_TERMINATOR } from './runs/run-abort';
import { DATA_ROOM_ATTACHED_PREFIX, FILE_CONTENT_MARKER } from './data-room-rehydrate';
import { ExportService } from '../export/export.service';
import { conversationFilenameSlug } from './conversation-filename';
import { CONVERSATION_PDF_OPTIONS } from '../export/templates/conversation';

// ── Mocks ────────────────────────────────────────────────────────────────────

const listQb: any = {
  leftJoin: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};

const mockConversationRepo = {
  createQueryBuilder: jest.fn(() => listQb),
  find: jest.fn(),
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

const mockMessageRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((e: any) => e),
  save: jest.fn(async (e: any) => e),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

const mockExportService = {
  htmlToPdf: jest.fn(async () => Buffer.from('pdf')),
  htmlToDocx: jest.fn(async () => Buffer.from('docx')),
};

const mockMemberRepo = {
  findOneBy: jest.fn(),
};

const mockRunRepo = {
  findOne: jest.fn(),
};

const mockSummaryService = {
  summarize: jest.fn(),
};

// CaseAccessService delegate — internally uses mockMemberRepo so existing
// test assertions on mockMemberRepo.findOneBy keep working.
const mockCaseAccess = {
  assertAccess: jest.fn(async ({ userId }: { userId: string }, caseId: string) => {
    const membership = await mockMemberRepo.findOneBy({ userId, caseId });
    if (!membership) {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('You do not have access to this case');
    }
    return membership;
  }),
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
        {
          provide: CaseAccessService,
          useValue: mockCaseAccess,
        },
        { provide: ExportService, useValue: mockExportService },
        { provide: getRepositoryToken(AgentRunEntity), useValue: mockRunRepo },
        { provide: ConversationSummaryService, useValue: mockSummaryService },
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
      listQb.getMany.mockResolvedValue([]);

      await service.findAllForUserInCase(CASE_ID, USER_ID);

      // Membership check happened
      expect(mockMemberRepo.findOneBy).toHaveBeenCalledWith({
        userId: USER_ID,
        caseId: CASE_ID,
      });

      // And it happened BEFORE the find()
      const memberCallOrder =
        mockMemberRepo.findOneBy.mock.invocationCallOrder[0];
      const findCallOrder = mockConversationRepo.createQueryBuilder.mock.invocationCallOrder[0];
      expect(memberCallOrder).toBeLessThan(findCallOrder);

      // The find clause MUST contain both keys — guests sharing a case must not
      // see the conversation owner's threads.
      expect(listQb.where).toHaveBeenCalledWith('c.caseId = :caseId', { caseId: CASE_ID });
      expect(listQb.andWhere).toHaveBeenCalledWith('c.userId = :userId', { userId: USER_ID });
    });

    it('throws ForbiddenException when caller is not a case member (find never called)', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.findAllForUserInCase(CASE_ID, USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockConversationRepo.createQueryBuilder).not.toHaveBeenCalled();
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

  describe('getMessagesForDisplay', () => {
    it('omits the file-content marker rows and keeps everything else in order', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: CONV_ID } as any);
      const rows = [
        { id: '1', role: 'user', content: [{ type: 'text', text: 'read it' }] },
        { id: '2', role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'read_data_room_file', input: {} }] },
        { id: '3', role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: '{}' }] },
        { id: '4', role: 'assistant', content: [{ type: 'text', text: FILE_CONTENT_MARKER }] },
        { id: '5', role: 'user', content: [{ type: 'data_room_ref', origin: 'read', fileId: 'f', name: 'f.pdf', mediaType: 'application/pdf' }] },
        { id: '6', role: 'assistant', content: [{ type: 'text', text: `It says ${FILE_CONTENT_MARKER}` }] },
      ];
      mockMessageRepo.find.mockResolvedValue(rows);

      const out = await service.getMessagesForDisplay(CONV_ID, USER_ID);

      expect(out.map((m) => m.id)).toEqual(['1', '2', '3', '5', '6']);
    });

    it('strips the agent-facing attached-files note from user rows only', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: CONV_ID } as any);
      const ref = { type: 'data_room_ref', origin: 'upload', fileId: 'f', name: 'a.pdf', mediaType: 'application/pdf' };
      const note = { type: 'text', text: `${DATA_ROOM_ATTACHED_PREFIX}: a.pdf (fileId f). Record notes for each with record_file_notes before answering.` };
      mockMessageRepo.find.mockResolvedValue([
        { id: '1', role: 'user', content: [ref, note, { type: 'text', text: 'look' }] },
        { id: '2', role: 'assistant', content: [note] },
      ]);

      const out = await service.getMessagesForDisplay(CONV_ID, USER_ID);

      expect(out[0].content).toEqual([ref, { type: 'text', text: 'look' }]);
      expect(out[1].content).toEqual([note]);
    });

    it('keeps a user-typed attached-files line when the row has no upload pointer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: CONV_ID } as any);
      const typed = { type: 'text', text: `${DATA_ROOM_ATTACHED_PREFIX}: please explain this phrase` };
      mockMessageRepo.find.mockResolvedValue([{ id: '1', role: 'user', content: [typed] }]);

      const out = await service.getMessagesForDisplay(CONV_ID, USER_ID);

      expect(out[0].content).toEqual([typed]);
    });

    it('getMessages (the model history) still includes the marker row', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: CONV_ID } as any);
      mockMessageRepo.find.mockResolvedValue([{ id: '4', role: 'assistant', content: [{ type: 'text', text: FILE_CONTENT_MARKER }] }]);
      expect(await service.getMessages(CONV_ID, USER_ID)).toHaveLength(1);
    });
  });

  describe('run helpers', () => {
    it('appends the terminator when the tail is a user turn of only tool_result blocks', async () => {
      mockMessageRepo.findOne.mockResolvedValue({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{}' }] });
      await service.appendTerminatorIfToolResultTail('conv-1');
      expect(mockMessageRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 'conv-1', role: 'assistant', content: [{ type: 'text', text: TOOL_RESULT_TERMINATOR }],
      }));
    });

    it('does nothing when the tail is an assistant turn or a user text turn', async () => {
      mockMessageRepo.findOne.mockResolvedValueOnce({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
      await service.appendTerminatorIfToolResultTail('conv-1');
      mockMessageRepo.findOne.mockResolvedValueOnce({ role: 'user', content: [{ type: 'text', text: 'q' }] });
      await service.appendTerminatorIfToolResultTail('conv-1');
      expect(mockMessageRepo.save).not.toHaveBeenCalled();
    });

    it('deleteMessage deletes only within the conversation', async () => {
      await service.deleteMessage('conv-1', 'msg-1');
      expect(mockMessageRepo.delete).toHaveBeenCalledWith({ id: 'msg-1', conversationId: 'conv-1' });
    });
  });

  // ── export + oldestMessageAt ───────────────────────────────────────────────

  describe('export', () => {
    const conv = {
      id: CONV_ID,
      userId: USER_ID,
      caseId: CASE_ID,
      title: 'My Chat!',
      createdAt: new Date('2026-03-04T10:00:00Z'),
      historyTruncatedAt: null as Date | null,
      case: { name: 'Case A' },
      user: { name: 'Ann', email: 'ann@x.com' },
    };

    beforeEach(() => {
      mockMemberRepo.findOneBy.mockResolvedValue(membership);
      mockConversationRepo.findOneBy.mockResolvedValue(conv);
      mockConversationRepo.findOne.mockResolvedValue(conv);
      mockMessageRepo.find.mockResolvedValue([
        { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], createdAt: new Date('2026-03-04T10:01:00Z') },
      ]);
    });

    it('rejects a non-owner', async () => {
      mockConversationRepo.findOneBy.mockResolvedValue({ ...conv, userId: OTHER_USER_ID });
      await expect(service.export(CONV_ID, USER_ID, 'pdf')).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockExportService.htmlToPdf).not.toHaveBeenCalled();
    });

    it('pdf uses footer options and the 120s timeout', async () => {
      const out = await service.export(CONV_ID, USER_ID, 'pdf');
      expect(mockExportService.htmlToPdf).toHaveBeenCalledWith(expect.stringContaining('hello'), CONVERSATION_PDF_OPTIONS);
      expect((mockExportService.htmlToPdf.mock.calls[0] as any[])[1].timeout).toBe(120_000);
      expect(mockExportService.htmlToDocx).not.toHaveBeenCalled();
      expect(out).toMatchObject({ filename: 'my-chat.pdf', contentType: 'application/pdf' });
    });

    it('docx calls htmlToDocx', async () => {
      const out = await service.export(CONV_ID, USER_ID, 'docx');
      expect(mockExportService.htmlToDocx).toHaveBeenCalled();
      expect(mockExportService.htmlToPdf).not.toHaveBeenCalled();
      expect(out.filename).toBe('my-chat.docx');
    });

    it('truncatedByRetention follows historyTruncatedAt', async () => {
      await service.export(CONV_ID, USER_ID, 'docx');
      const plain = (mockExportService.htmlToDocx.mock.calls[0] as any[])[0] as string;
      mockConversationRepo.findOne.mockResolvedValue({ ...conv, historyTruncatedAt: new Date() });
      await service.export(CONV_ID, USER_ID, 'docx');
      const truncated = (mockExportService.htmlToDocx.mock.calls[1] as any[])[0] as string;
      expect(truncated).not.toEqual(plain);
      expect(truncated.length).toBeGreaterThan(plain.length);
    });
  });

  describe('conversationFilenameSlug', () => {
    const d = new Date('2026-03-04T10:00:00Z');
    it('strips special characters', () => {
      expect(conversationFilenameSlug('  Hello, "World"/../x\r\n! ', d)).toBe('hello-world-x');
    });
    it('caps at 60 chars without a trailing dash', () => {
      const slug = conversationFilenameSlug('a'.repeat(59) + ' bbbbbb', d);
      expect(slug.length).toBeLessThanOrEqual(60);
      expect(slug.endsWith('-')).toBe(false);
    });
    it('falls back to the creation date', () => {
      expect(conversationFilenameSlug('', d)).toBe('conversation-2026-03-04');
      expect(conversationFilenameSlug('???', d)).toBe('conversation-2026-03-04');
      expect(conversationFilenameSlug(null, d)).toBe('conversation-2026-03-04');
    });
  });

  describe('oldestMessageAt', () => {
    it('is null on create', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(membership);
      mockConversationRepo.create.mockImplementation((d) => d);
      mockConversationRepo.save.mockImplementation(async (e) => e);
      expect((await service.create(CASE_ID, USER_ID)).oldestMessageAt).toBeNull();
    });

    it('comes from one grouped query; null for an empty conversation', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(membership);
      listQb.getMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { conversationId: 'a', oldest: new Date('2026-01-02T03:04:05Z') },
        ]),
      };
      mockMessageRepo.createQueryBuilder.mockReturnValue(qb);
      const out = await service.findAllForUserInCase(CASE_ID, USER_ID);
      expect(mockMessageRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(out.map((c) => c.oldestMessageAt)).toEqual(['2026-01-02T03:04:05.000Z', null]);
    });
  });

  // ── continue (long-conversation handoff) ───────────────────────────────────

  describe('continue', () => {
    const source = { id: CONV_ID, caseId: CASE_ID, userId: USER_ID, title: 'Acme hack trace', seedSummary: null };

    beforeEach(() => {
      mockMemberRepo.findOneBy.mockResolvedValue(membership);
      mockConversationRepo.findOneBy.mockResolvedValue(source);
      mockRunRepo.findOne.mockResolvedValue(null);
      mockSummaryService.summarize.mockResolvedValue('## 1. Goal of the work\nTrace the funds');
      mockConversationRepo.create.mockImplementation((d) => d);
      mockConversationRepo.save.mockImplementation(async (e) => ({ ...e, id: 'conv-new', contextTokens: 0 }));
    });

    it('rejects a non-owner and creates nothing', async () => {
      mockConversationRepo.findOneBy.mockResolvedValue({ ...source, userId: OTHER_USER_ID });
      await expect(service.continue(CONV_ID, USER_ID)).rejects.toBeInstanceOf(ForbiddenException);
      expect(mockSummaryService.summarize).not.toHaveBeenCalled();
      expect(mockConversationRepo.save).not.toHaveBeenCalled();
    });

    it('returns 404 for a missing conversation', async () => {
      mockConversationRepo.findOneBy.mockResolvedValue(null);
      await expect(service.continue(CONV_ID, USER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s while a run is queued or running, before summarizing', async () => {
      mockRunRepo.findOne.mockResolvedValue({ id: 'run-1', status: 'running' });
      await expect(service.continue(CONV_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
      const where = mockRunRepo.findOne.mock.calls[0][0].where;
      expect(where.conversationId).toBe(CONV_ID);
      expect(where.status.value).toEqual(['queued', 'running']);
      expect(mockSummaryService.summarize).not.toHaveBeenCalled();
      expect(mockConversationRepo.save).not.toHaveBeenCalled();
    });

    it('creates a linked, seeded conversation in the same case with a (continued) title', async () => {
      const out = await service.continue(CONV_ID, USER_ID);
      expect(mockSummaryService.summarize).toHaveBeenCalledWith(CONV_ID);
      expect(mockConversationRepo.create).toHaveBeenCalledWith({
        caseId: CASE_ID,
        userId: USER_ID,
        title: 'Acme hack trace (continued)',
        seedSummary: '## 1. Goal of the work\nTrace the funds',
        continuedFromConversationId: CONV_ID,
      });
      expect(out).toEqual(
        expect.objectContaining({
          id: 'conv-new',
          contextTokens: 0,
          seedSummary: '## 1. Goal of the work\nTrace the funds',
          continuedFromConversationId: CONV_ID,
          continuedFromTitle: 'Acme hack trace',
          oldestMessageAt: null,
        }),
      );
    });

    it('titles an untitled source "Untitled conversation (continued)"', async () => {
      mockConversationRepo.findOneBy.mockResolvedValue({ ...source, title: null });
      await service.continue(CONV_ID, USER_ID);
      expect(mockConversationRepo.create.mock.calls[0][0].title).toBe('Untitled conversation (continued)');
    });

    it('throws 502 and creates nothing when the summary fails', async () => {
      mockSummaryService.summarize.mockRejectedValue(new Error('timeout'));
      await expect(service.continue(CONV_ID, USER_ID)).rejects.toBeInstanceOf(BadGatewayException);
      expect(mockConversationRepo.create).not.toHaveBeenCalled();
      expect(mockConversationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('continuation fields on list and create', () => {
    it('list returns continuedFromTitle from one join, plus the other Conversation fields', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(membership);
      listQb.getMany.mockResolvedValue([
        {
          id: 'b',
          title: 'Acme hack trace (continued)',
          contextTokens: 1200,
          seedSummary: 'S',
          continuedFromConversationId: 'a',
          continuedFrom: { id: 'a', title: 'Acme hack trace' },
        },
        { id: 'a', title: 'Acme hack trace', contextTokens: 900000, seedSummary: null, continuedFromConversationId: null, continuedFrom: null },
      ]);
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      mockMessageRepo.createQueryBuilder.mockReturnValue(qb);

      const out = await service.findAllForUserInCase(CASE_ID, USER_ID);

      expect(listQb.leftJoin).toHaveBeenCalledWith('c.continuedFrom', 'cf');
      expect(listQb.addSelect).toHaveBeenCalledWith(['cf.id', 'cf.title']);
      expect(out[0]).toEqual(
        expect.objectContaining({
          contextTokens: 1200,
          seedSummary: 'S',
          continuedFromConversationId: 'a',
          continuedFromTitle: 'Acme hack trace',
        }),
      );
      expect(out[0]).not.toHaveProperty('continuedFrom');
      expect(out[1].continuedFromTitle).toBeNull();
      expect(out[1].contextTokens).toBe(900000);
    });

    it('create returns the continuation fields as empty', async () => {
      mockMemberRepo.findOneBy.mockResolvedValue(membership);
      mockConversationRepo.create.mockImplementation((d) => d);
      mockConversationRepo.save.mockImplementation(async (e) => e);
      const out = await service.create(CASE_ID, USER_ID);
      expect(out).toEqual(
        expect.objectContaining({
          contextTokens: 0,
          seedSummary: null,
          continuedFromConversationId: null,
          continuedFromTitle: null,
          oldestMessageAt: null,
        }),
      );
    });
  });
});
