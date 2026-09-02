import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { ScriptRunEntity } from '../../database/entities/script-run.entity';
import { TraceEntity } from '../../database/entities/trace.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { TRACE_COLORS } from '../../generated/shared/trace-colors';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInvRepo = {
  findOneBy: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const mockCaseRepo = {
  findOneBy: jest.fn(),
};

const mockScriptRunRepo = {
  find: jest.fn(),
};

const mockTraceRepo = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockCaseAccess = {
  assertRole: jest.fn(),
};

const mockDataSource = {
  transaction: jest.fn(),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID = 'case-1';
const caseEntity = { id: CASE_ID } as CaseEntity;

/**
 * Wire dataSource.transaction to invoke the callback with a fake EntityManager
 * whose `create`/`save`/`findOneBy`/`findOne` delegate to the per-entity repo
 * mocks above, mirroring how CasesService's spec drives `manager.*` calls.
 */
function setupTransaction() {
  const mockManager = {
    create: jest.fn((entity: any, args: any) => {
      if (entity === InvestigationEntity) return mockInvRepo.create(args);
      if (entity === TraceEntity) return mockTraceRepo.create(args);
      throw new Error(`Unexpected entity passed to manager.create: ${entity}`);
    }),
    save: jest.fn((arg: any) => {
      // Distinguish investigation vs trace saves by shape: the investigation
      // carries `name`/`caseId` at the top level from repo.create's echo, the
      // trace carries `investigationId` + `data`.
      if (arg && Object.prototype.hasOwnProperty.call(arg, 'investigationId')) {
        return mockTraceRepo.save(arg);
      }
      return mockInvRepo.save(arg);
    }),
    findOneBy: jest.fn((entity: any, where: any) => {
      if (entity === CaseEntity) return mockCaseRepo.findOneBy(where);
      throw new Error(`Unexpected entity passed to manager.findOneBy: ${entity}`);
    }),
    findOne: jest.fn((entity: any, options: any) => {
      if (entity === InvestigationEntity) return mockInvRepo.findOne(options);
      throw new Error(`Unexpected entity passed to manager.findOne: ${entity}`);
    }),
  };
  mockDataSource.transaction.mockImplementation((cb: (m: any) => Promise<any>) => cb(mockManager));
  return mockManager;
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('InvestigationsService', () => {
  let service: InvestigationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestigationsService,
        { provide: getRepositoryToken(InvestigationEntity), useValue: mockInvRepo },
        { provide: getRepositoryToken(CaseEntity), useValue: mockCaseRepo },
        { provide: getRepositoryToken(ScriptRunEntity), useValue: mockScriptRunRepo },
        { provide: getRepositoryToken(TraceEntity), useValue: mockTraceRepo },
        { provide: CaseAccessService, useValue: mockCaseAccess },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<InvestigationsService>(InvestigationsService);
  });

  // ── create ───────────────────────────────────────────────────────────────
  //
  // create() must mint the investigation's first trace in the same call — an
  // investigation with zero traces can't accept graph writes. See the
  // docstring on InvestigationsService.create for why. The two writes run in
  // one transaction, so these tests drive dataSource.transaction with a fake
  // manager rather than mocking the repos directly.

  describe('create', () => {
    beforeEach(() => {
      setupTransaction();
      mockCaseRepo.findOneBy.mockResolvedValue(caseEntity);
      mockInvRepo.create.mockImplementation((args) => ({ ...args }));
      mockInvRepo.save.mockImplementation((e) => Promise.resolve({ id: 'inv-1', ...e }));
      mockTraceRepo.create.mockImplementation((args) => ({ id: 'trace-1', ...args }));
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));
    });

    it('saves exactly one trace, on the new investigation, named "Trace 1", coloured TRACE_COLORS[0], with empty data', async () => {
      mockInvRepo.findOne.mockResolvedValue({ id: 'inv-1', name: 'New Investigation', traces: [] });

      await service.create(CASE_ID, { name: 'New Investigation' });

      expect(mockTraceRepo.save).toHaveBeenCalledTimes(1);
      expect(mockTraceRepo.create).toHaveBeenCalledWith({
        name: 'Trace 1',
        color: TRACE_COLORS[0],
        visible: true,
        collapsed: false,
        data: { nodes: [], edges: [] },
        investigationId: 'inv-1',
      });
    });

    it('uses initialTraceName when provided', async () => {
      mockInvRepo.findOne.mockResolvedValue({ id: 'inv-1', name: 'X', traces: [] });

      await service.create(CASE_ID, { name: 'X', initialTraceName: 'Polygon flow' });

      expect(mockTraceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Polygon flow' }),
      );
    });

    it('falls back to "Trace 1" when initialTraceName is whitespace-only', async () => {
      mockInvRepo.findOne.mockResolvedValue({ id: 'inv-1', name: 'X', traces: [] });

      await service.create(CASE_ID, { name: 'X', initialTraceName: '   ' });

      expect(mockTraceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Trace 1' }),
      );
    });

    it('returns the investigation with the traces relation populated', async () => {
      const trace = { id: 'trace-1', name: 'Trace 1' };
      const withTraces = { id: 'inv-1', name: 'X', traces: [trace] };
      mockInvRepo.findOne.mockResolvedValue(withTraces);

      const result = await service.create(CASE_ID, { name: 'X' });

      expect(mockInvRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        relations: ['traces'],
      });
      expect(result).toEqual(withTraces);
    });

    it('throws NotFoundException for an invalid case', async () => {
      mockCaseRepo.findOneBy.mockResolvedValue(null);

      await expect(service.create('bad-case', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(mockTraceRepo.save).not.toHaveBeenCalled();
    });

    it('rejects the whole call when the trace save fails, leaving no investigation committed', async () => {
      mockInvRepo.findOne.mockResolvedValue({ id: 'inv-1', name: 'X', traces: [] });
      mockTraceRepo.save.mockRejectedValue(new Error('trace insert failed'));

      await expect(service.create(CASE_ID, { name: 'X' })).rejects.toThrow('trace insert failed');
    });
  });
});
