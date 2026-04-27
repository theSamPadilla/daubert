import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TracesService } from './traces.service';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseAccessService } from '../auth/case-access.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockTraceRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockInvRepo = {
  findOneBy: jest.fn(),
};

const mockCaseAccess = {
  assertAccess: jest.fn(),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

const INV_ID = 'inv-1';
const CASE_ID = 'case-1';
const USER_ID = 'user-1';
const PRINCIPAL = { kind: 'user' as const, userId: USER_ID };

const investigation = { id: INV_ID, caseId: CASE_ID } as InvestigationEntity;

const baseTrace = {
  id: 'trace-1',
  name: 'Main Trace',
  color: null,
  visible: true,
  collapsed: false,
  investigationId: INV_ID,
  data: {},
} as unknown as TraceEntity;

const traceWithData = {
  id: 'trace-1',
  name: 'Main Trace',
  investigationId: INV_ID,
  data: {
    nodes: [
      { id: 'n1', address: '0xaaa', label: 'Node 1' },
      { id: 'n2', address: '0xbbb', label: 'Node 2' },
      { id: 'n3', address: '0xccc', label: 'Node 3' },
    ],
    edges: [
      { id: 'e1', from: 'n1', to: 'n2', txHash: '0x111' },
      { id: 'e2', from: 'n2', to: 'n3', txHash: '0x222' },
    ],
    edgeBundles: [
      { id: 'b1', edgeIds: ['e1', 'e2'] },
      { id: 'b2', edgeIds: ['e2'] },
    ],
  },
} as unknown as TraceEntity;

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('TracesService', () => {
  let service: TracesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracesService,
        { provide: getRepositoryToken(TraceEntity), useValue: mockTraceRepo },
        { provide: getRepositoryToken(InvestigationEntity), useValue: mockInvRepo },
        { provide: CaseAccessService, useValue: mockCaseAccess },
      ],
    }).compile();

    service = module.get<TracesService>(TracesService);
  });

  // ── CRUD ─────────────────────────────────────────────────────────────────

  describe('findAllForInvestigation', () => {
    it('returns traces for a valid investigation', async () => {
      const traces = [baseTrace];
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue(traces);

      const result = await service.findAllForInvestigation(INV_ID, PRINCIPAL);

      expect(result).toEqual(traces);
      expect(mockInvRepo.findOneBy).toHaveBeenCalledWith({ id: INV_ID });
      expect(mockTraceRepo.find).toHaveBeenCalledWith({
        where: { investigationId: INV_ID },
        order: { createdAt: 'ASC' },
      });
    });

    it('throws NotFoundException for an invalid investigation', async () => {
      mockInvRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findAllForInvestigation('bad-id', PRINCIPAL)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('checks access via assertAccess with the principal', async () => {
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue([]);

      await service.findAllForInvestigation(INV_ID, PRINCIPAL);

      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(PRINCIPAL, CASE_ID);
    });
  });

  describe('findOne', () => {
    it('returns a trace by id', async () => {
      mockTraceRepo.findOneBy.mockResolvedValue(baseTrace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);

      const result = await service.findOne('trace-1', PRINCIPAL);

      expect(result).toEqual(baseTrace);
      expect(mockTraceRepo.findOneBy).toHaveBeenCalledWith({ id: 'trace-1' });
    });

    it('throws NotFoundException when trace does not exist', async () => {
      mockTraceRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('missing', PRINCIPAL)).rejects.toThrow(NotFoundException);
    });

    it('checks access via assertAccess with the principal', async () => {
      mockTraceRepo.findOneBy.mockResolvedValue(baseTrace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);

      await service.findOne('trace-1', PRINCIPAL);

      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(PRINCIPAL, CASE_ID);
    });
  });

  describe('create', () => {
    it('creates a trace in a valid investigation', async () => {
      const dto = { name: 'New Trace', color: '#ff0000' };
      const created = { ...baseTrace, ...dto };
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.create.mockReturnValue(created);
      mockTraceRepo.save.mockResolvedValue(created);

      const result = await service.create(INV_ID, dto, PRINCIPAL);

      expect(mockTraceRepo.create).toHaveBeenCalledWith({
        name: 'New Trace',
        color: '#ff0000',
        visible: true,
        collapsed: false,
        data: {},
        investigationId: INV_ID,
      });
      expect(mockTraceRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(created);
    });

    it('throws NotFoundException for an invalid investigation', async () => {
      mockInvRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.create('bad-inv', { name: 'Test' }, PRINCIPAL),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates only specified fields', async () => {
      const existing = { ...baseTrace, name: 'Old Name', visible: true };
      mockTraceRepo.findOneBy.mockResolvedValue(existing);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.update('trace-1', { name: 'New Name' }, PRINCIPAL);

      expect(result.name).toBe('New Name');
      // visible was not in the dto, so it should remain unchanged
      expect(result.visible).toBe(true);
      expect(mockTraceRepo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the trace', async () => {
      mockTraceRepo.findOneBy.mockResolvedValue(baseTrace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.remove.mockResolvedValue(undefined);

      await service.remove('trace-1', PRINCIPAL);

      expect(mockTraceRepo.remove).toHaveBeenCalledWith(baseTrace);
    });

    it('throws NotFoundException when trace does not exist', async () => {
      mockTraceRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing', PRINCIPAL)).rejects.toThrow(NotFoundException);
    });
  });

  // ── JSONB Node Operations ────────────────────────────────────────────────

  describe('updateNode', () => {
    it('updates a node in trace.data.nodes', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateNode('trace-1', 'n1', {
        label: 'Updated Node 1',
        color: '#00ff00',
      }, PRINCIPAL);

      expect(result.label).toBe('Updated Node 1');
      expect(result.color).toBe('#00ff00');
      // Original fields preserved
      expect(result.id).toBe('n1');
      expect(result.address).toBe('0xaaa');

      // Verify saved data has the updated node
      const savedData = mockTraceRepo.save.mock.calls[0][0].data;
      expect(savedData.nodes.find((n: any) => n.id === 'n1').label).toBe('Updated Node 1');
      // Other nodes untouched
      expect(savedData.nodes.find((n: any) => n.id === 'n2').label).toBe('Node 2');
    });

    it('throws NotFoundException for a missing node', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);

      await expect(
        service.updateNode('trace-1', 'nonexistent', { label: 'X' }, PRINCIPAL),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateEdge', () => {
    it('updates an edge in trace.data.edges', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateEdge('trace-1', 'e1', {
        label: 'Transfer',
        amount: '1.5',
      }, PRINCIPAL);

      expect(result.label).toBe('Transfer');
      expect(result.amount).toBe('1.5');
      // Original fields preserved
      expect(result.id).toBe('e1');
      expect(result.txHash).toBe('0x111');

      const savedData = mockTraceRepo.save.mock.calls[0][0].data;
      expect(savedData.edges.find((e: any) => e.id === 'e1').label).toBe('Transfer');
    });

    it('merges token object instead of replacing it', async () => {
      const trace = structuredClone(traceWithData);
      // Pre-set a token on the edge
      (trace.data as any).edges[0].token = { symbol: 'ETH', decimals: 18 };
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.updateEdge('trace-1', 'e1', {
        token: { address: '0xtoken' },
      }, PRINCIPAL);

      expect(result.token).toEqual({
        symbol: 'ETH',
        decimals: 18,
        address: '0xtoken',
      });
    });

    it('throws NotFoundException for a missing edge', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);

      await expect(
        service.updateEdge('trace-1', 'nonexistent', { label: 'X' }, PRINCIPAL),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── JSONB Delete Operations ──────────────────────────────────────────────

  describe('deleteNode', () => {
    it('removes the node and all connected edges', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.deleteNode('trace-1', 'n2', PRINCIPAL);

      const savedData = mockTraceRepo.save.mock.calls[0][0].data;

      // n2 removed, n1 and n3 remain
      expect(savedData.nodes.map((n: any) => n.id)).toEqual(['n1', 'n3']);

      // Both edges connected to n2 removed (e1: n1->n2, e2: n2->n3)
      expect(savedData.edges).toEqual([]);
    });

    it('only removes edges connected to the deleted node', async () => {
      const trace = structuredClone(traceWithData);
      // Add an edge not connected to n1
      (trace.data as any).edges.push({ id: 'e3', from: 'n2', to: 'n3', txHash: '0x333' });
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.deleteNode('trace-1', 'n1', PRINCIPAL);

      const savedData = mockTraceRepo.save.mock.calls[0][0].data;
      // e1 (n1->n2) removed, e2 and e3 remain
      expect(savedData.edges.map((e: any) => e.id)).toEqual(['e2', 'e3']);
    });

    it('throws NotFoundException for a missing node', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);

      await expect(
        service.deleteNode('trace-1', 'nonexistent', PRINCIPAL),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteEdge', () => {
    it('removes the edge and cleans up edge bundles', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.deleteEdge('trace-1', 'e1', PRINCIPAL);

      const savedData = mockTraceRepo.save.mock.calls[0][0].data;

      // e1 removed, e2 remains
      expect(savedData.edges.map((e: any) => e.id)).toEqual(['e2']);

      // b1 originally had ['e1','e2'], now just ['e2']
      // b2 originally had ['e2'], stays ['e2']
      expect(savedData.edgeBundles).toEqual([
        { id: 'b1', edgeIds: ['e2'] },
        { id: 'b2', edgeIds: ['e2'] },
      ]);
    });

    it('removes edge bundles that become empty after edge deletion', async () => {
      const trace = structuredClone(traceWithData);
      // Make b1 only reference e1 so it becomes empty when e1 is deleted
      (trace.data as any).edgeBundles[0].edgeIds = ['e1'];
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.deleteEdge('trace-1', 'e1', PRINCIPAL);

      const savedData = mockTraceRepo.save.mock.calls[0][0].data;

      // b1 becomes empty and is removed, b2 stays
      expect(savedData.edgeBundles).toEqual([
        { id: 'b2', edgeIds: ['e2'] },
      ]);
    });

    it('throws NotFoundException for a missing edge', async () => {
      const trace = structuredClone(traceWithData);
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);

      await expect(
        service.deleteEdge('trace-1', 'nonexistent', PRINCIPAL),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
