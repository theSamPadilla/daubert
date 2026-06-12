import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentAuditService } from './agent-audit.service';
import { AgentAuditLogEntity } from '../../database/entities/agent-audit-log.entity';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_ID = 'session-uuid';
const USER_ID = 'user-uuid';
const ORG_ID = 'org-uuid';
const ACTION = 'import_transactions';

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('AgentAuditService', () => {
  let service: AgentAuditService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentAuditService,
        {
          provide: getRepositoryToken(AgentAuditLogEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<AgentAuditService>(AgentAuditService);
  });

  describe('log()', () => {
    it('persists a row with the required fields', async () => {
      const entity = { sessionId: SESSION_ID, userId: USER_ID, organizationId: ORG_ID, action: ACTION, status: 'ok', targetRef: null, detail: null };
      mockRepo.create.mockReturnValue(entity);
      mockRepo.save.mockResolvedValue(entity);

      await service.log({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: ACTION,
        status: 'ok',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: SESSION_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          action: ACTION,
          status: 'ok',
        }),
      );
      expect(mockRepo.save).toHaveBeenCalledWith(entity);
    });

    it('includes targetRef when provided', async () => {
      const entity = {};
      mockRepo.create.mockReturnValue(entity);
      mockRepo.save.mockResolvedValue(entity);

      await service.log({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'read_trace',
        status: 'ok',
        targetRef: 'trace:some-uuid',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetRef: 'trace:some-uuid' }),
      );
    });

    it('includes detail when provided', async () => {
      const entity = {};
      mockRepo.create.mockReturnValue(entity);
      mockRepo.save.mockResolvedValue(entity);

      const detail = { count: 5, error: 'timeout' };

      await service.log({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'import_transactions',
        status: 'error',
        detail,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ detail, status: 'error' }),
      );
    });

    it('defaults targetRef to null when omitted', async () => {
      const entity = {};
      mockRepo.create.mockReturnValue(entity);
      mockRepo.save.mockResolvedValue(entity);

      await service.log({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: ACTION,
        status: 'ok',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetRef: null }),
      );
    });

    it('defaults detail to null when omitted', async () => {
      const entity = {};
      mockRepo.create.mockReturnValue(entity);
      mockRepo.save.mockResolvedValue(entity);

      await service.log({
        sessionId: SESSION_ID,
        userId: USER_ID,
        organizationId: ORG_ID,
        action: ACTION,
        status: 'ok',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ detail: null }),
      );
    });
  });
});
