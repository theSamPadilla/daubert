import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TracesService } from './traces.service';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { BlockchainService, TransactionResult } from '../blockchain/blockchain.service';
import { WalletSetDto } from './dto/search-between.dto';

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

const mockBlockchainService = {
  fetchHistory: jest.fn(),
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
        { provide: BlockchainService, useValue: mockBlockchainService },
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

  // ── resolveWalletSet ─────────────────────────────────────────────────────

  describe('resolveWalletSet', () => {
    /**
     * Minimal TraceEntity factory for resolveWalletSet tests.
     * Groups live on trace.data.groups; membership lives on node.groupId.
     */
    function makeFakeTrace(overrides: {
      id?: string;
      name?: string;
      groups?: Array<{ id: string; name: string; color: string; traceId: string; collapsed?: boolean }>;
      nodes?: Array<{ id: string; address: string; chain: string; groupId?: string }>;
    }): TraceEntity {
      return {
        id: overrides.id ?? 'fake-trace',
        name: overrides.name ?? 'Fake',
        color: null,
        visible: true,
        collapsed: false,
        investigationId: 'fake-inv',
        data: {
          groups: overrides.groups ?? [],
          nodes: overrides.nodes ?? [],
          edges: [],
        },
      } as unknown as TraceEntity;
    }

    it('returns addresses for wallets in the group (group membership lives on node.groupId)', () => {
      const trace = makeFakeTrace({
        groups: [{ id: 'g1', name: 'A', color: '#000', traceId: 'fake-trace' }],
        nodes: [
          { id: 'n1', address: '0xAAA', chain: 'ethereum', groupId: 'g1' },
          { id: 'n2', address: '0xBBB', chain: 'ethereum', groupId: 'g1' },
          { id: 'n3', address: '0xCCC', chain: 'ethereum' }, // no groupId
        ],
      });
      const set = service.resolveWalletSet([trace], { groupId: 'g1' } as WalletSetDto, 'ethereum');
      expect([...set].sort()).toEqual(['0xaaa', '0xbbb']);
    });

    it('resolves groupId across multiple traces (group is in the second trace)', () => {
      const trace1 = makeFakeTrace({
        id: 'trace-1',
        groups: [],
        nodes: [{ id: 'n1', address: '0xAAA', chain: 'ethereum' }],
      });
      const trace2 = makeFakeTrace({
        id: 'trace-2',
        groups: [{ id: 'g2', name: 'B', color: '#000', traceId: 'trace-2' }],
        nodes: [
          { id: 'n2', address: '0xBBB', chain: 'ethereum', groupId: 'g2' },
          { id: 'n3', address: '0xCCC', chain: 'ethereum', groupId: 'g2' },
        ],
      });
      const set = service.resolveWalletSet([trace1, trace2], { groupId: 'g2' } as WalletSetDto, 'ethereum');
      expect([...set].sort()).toEqual(['0xbbb', '0xccc']);
    });

    it('returns all node addresses when resolving by traceId', () => {
      const trace = makeFakeTrace({
        id: 'trace-abc',
        nodes: [
          { id: 'n1', address: '0xAAA', chain: 'ethereum' },
          { id: 'n2', address: '0xBBB', chain: 'ethereum' },
        ],
      });
      const set = service.resolveWalletSet([trace], { traceId: 'trace-abc' } as WalletSetDto, 'ethereum');
      expect([...set].sort()).toEqual(['0xaaa', '0xbbb']);
    });

    it('lowercases EVM addresses from an explicit wallet list', () => {
      const set = service.resolveWalletSet(
        [makeFakeTrace({})],
        { wallets: ['0xAaA', '0xBbB'] } as WalletSetDto,
        'ethereum',
      );
      expect([...set]).toEqual(['0xaaa', '0xbbb']);
    });

    it('preserves Tron base58 case from an explicit wallet list', () => {
      const tronA = 'TEsCiXabcdefghijklmnopqrstuvwxyz12';
      const tronB = 'TKr41tABCDEFGHJKLMNPQRSTUVWXYZabcd';
      const set = service.resolveWalletSet(
        [makeFakeTrace({})],
        { wallets: [tronA, tronB] } as WalletSetDto,
        'tron',
      );
      expect([...set].sort()).toEqual([tronA, tronB].sort());
    });

    it('throws when groupId is not in any trace', () => {
      expect(() =>
        service.resolveWalletSet(
          [makeFakeTrace({ groups: [] })],
          { groupId: 'missing' } as WalletSetDto,
          'ethereum',
        ),
      ).toThrow(/group not found/i);
    });

    it('throws when traceId is not in the investigation', () => {
      expect(() =>
        service.resolveWalletSet(
          [makeFakeTrace({ id: 'other-trace' })],
          { traceId: 'nonexistent' } as WalletSetDto,
          'ethereum',
        ),
      ).toThrow(/trace .* not found/i);
    });

    it('throws when both groupId and wallets are provided', () => {
      expect(() =>
        service.resolveWalletSet(
          [makeFakeTrace({})],
          { groupId: 'g1', wallets: ['0xa'] } as WalletSetDto,
          'ethereum',
        ),
      ).toThrow(/exactly one/i);
    });

    it('throws when neither is provided', () => {
      expect(() =>
        service.resolveWalletSet([makeFakeTrace({})], {} as WalletSetDto, 'ethereum'),
      ).toThrow(/exactly one/i);
    });
  });

  // ── searchBetween ────────────────────────────────────────────────────────

  describe('searchBetween', () => {
    /**
     * Minimal TraceEntity factory shared with searchBetween tests.
     */
    function makeFakeTrace(overrides: {
      id?: string;
      name?: string;
      groups?: Array<{ id: string; name: string; color: string; traceId: string; collapsed?: boolean }>;
      nodes?: Array<{ id: string; address: string; chain: string; groupId?: string }>;
    }): TraceEntity {
      return {
        id: overrides.id ?? 'fake-trace',
        name: overrides.name ?? 'Fake',
        color: null,
        visible: true,
        collapsed: false,
        investigationId: 'fake-inv',
        data: {
          groups: overrides.groups ?? [],
          nodes: overrides.nodes ?? [],
          edges: [],
        },
      } as unknown as TraceEntity;
    }

    const baseTrace = () => makeFakeTrace({ nodes: [], groups: [] });
    const baseTraces = () => [baseTrace()];

    /**
     * Factory for TransactionResult mocks.
     * Real shape (from blockchain.service.ts):
     *   token: { address: string; symbol: string; decimals: number }
     *   timestamp: string (ISO)
     *   amount: string
     *   txHash: string
     */
    const mockTxResult = (overrides: Partial<TransactionResult>): TransactionResult => ({
      id: 'fake-id',
      txHash: '0x0',
      from: '0x0',
      to: '0x0',
      chain: 'ethereum',
      timestamp: '2024-01-01T00:00:00.000Z',
      amount: '0',
      token: { address: '0x', symbol: 'ETH', decimals: 18 },
      blockNumber: 1,
      notes: '',
      tags: [],
      crossTrace: false,
      ...overrides,
    });

    beforeEach(() => {
      mockBlockchainService.fetchHistory.mockReset();
    });

    it('returns txs where from ∈ A and to ∈ B (direct, A-side fetched)', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({ txHash: '0x1', from: '0xa1', to: '0xb1' }),
          mockTxResult({ txHash: '0x2', from: '0xa1', to: '0xother' }),
        ],
        chain: 'ethereum',
        address: '0xa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].txHash).toBe('0x1');
      expect(result.fetchedSide).toBe('A');
      // analyzedCount = raw txs returned by provider before cross-set filter
      expect(result.analyzedCount).toBe(2);
    });

    it('returns txs where from ∈ B and to ∈ A (reverse direction, A-side fetched captures incoming)', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [mockTxResult({ txHash: '0x3', from: '0xb1', to: '0xa1' })],
        chain: 'ethereum',
        address: '0xa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].from.toLowerCase()).toBe('0xb1');
    });

    it('excludes intra-set txs (A↔A)', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [mockTxResult({ txHash: '0x4', from: '0xa1', to: '0xa2' })],
        chain: 'ethereum',
        address: '0xa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1', '0xa2'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(result.results).toHaveLength(0);
    });

    it('collapses rows with same (txHash, from, to) — matches importTransactions dedup', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({ txHash: '0x5', from: '0xa1', to: '0xb1', token: { address: '0x', symbol: 'ETH', decimals: 18 }, amount: '1' }),
          mockTxResult({ txHash: '0x5', from: '0xa1', to: '0xb1', token: { address: '0xusdc', symbol: 'USDC', decimals: 6 }, amount: '500' }),
        ],
        chain: 'ethereum',
        address: '0xa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].token).toMatch(/ETH/);
      expect(result.results[0].token).toMatch(/USDC/);
    });

    it('token dedup uses exact-match — ETH-LP prefix does not suppress ETH', async () => {
      // Three rows share the same (txHash, from, to) but carry different token symbols:
      //   row 1: "ETH-LP"  → kept as the first-seen token
      //   row 2: "USDC"    → appended (not a substring of "ETH-LP")
      //   row 3: "ETH"     → must also be appended; old .includes("ETH") would wrongly
      //                       match "ETH" inside "ETH-LP" and drop this symbol.
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({ txHash: '0x7', from: '0xa1', to: '0xb1', token: { address: '0xlp',   symbol: 'ETH-LP', decimals: 18 }, amount: '10' }),
          mockTxResult({ txHash: '0x7', from: '0xa1', to: '0xb1', token: { address: '0xusdc', symbol: 'USDC',   decimals: 6  }, amount: '500' }),
          mockTxResult({ txHash: '0x7', from: '0xa1', to: '0xb1', token: { address: '0x',     symbol: 'ETH',    decimals: 18 }, amount: '1' }),
        ],
        chain: 'ethereum',
        address: '0xa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(result.results).toHaveLength(1);
      const tokenField = result.results[0].token;
      expect(tokenField).toMatch(/ETH-LP/);
      expect(tokenField).toMatch(/USDC/);
      expect(tokenField).toMatch(/\bETH\b/);
    });

    it('rejects when a side exceeds 25 wallets', async () => {
      const tooMany = Array.from({ length: 26 }, (_, i) => `0xa${i}`);
      await expect(service.searchBetween(baseTraces(), {
        sideA: { wallets: tooMany },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      })).rejects.toThrow(/cap|limit|exceeding/i);
    });

    it('cap error message names the trace when resolved by traceId', async () => {
      const bigTrace = makeFakeTrace({
        id: 'big-trace',
        name: 'Exchange Wallets',
        nodes: Array.from({ length: 26 }, (_, i) => ({
          id: `n${i}`,
          address: `0x${'a'.repeat(38)}${String(i).padStart(2, '0')}`,
          chain: 'ethereum',
        })),
      });
      await expect(service.searchBetween([bigTrace], {
        sideA: { traceId: 'big-trace' },
        sideB: { wallets: ['0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1'] },
        chain: 'ethereum',
      })).rejects.toThrow(/Exchange Wallets/);
    });

    it('forwards timeRange to BlockchainService', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'ethereum',
        address: '0xa1',
      });
      await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
        timeRange: { startTimestamp: 1, endTimestamp: 2 },
      });
      expect(mockBlockchainService.fetchHistory).toHaveBeenCalledWith(
        '0xa1',
        'ethereum',
        expect.objectContaining({ startTimestamp: 1, endTimestamp: 2 }),
      );
    });

    it('fetches only the smaller side', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'ethereum',
        address: '0xb1',
      });
      await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1', '0xa2', '0xa3'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(mockBlockchainService.fetchHistory).toHaveBeenCalledTimes(1);
      expect(mockBlockchainService.fetchHistory).toHaveBeenCalledWith(
        '0xb1',
        'ethereum',
        expect.anything(),
      );
    });

    it('includes contract-creation rows (to is contractAddress, already populated by BlockchainService)', async () => {
      // BlockchainService substitutes contractAddress for empty to — by the time we see the tx,
      // to is populated. Just confirm the search treats it like any other tx.
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({ txHash: '0x6', from: '0xa1', to: '0xb1' }),
        ],
        chain: 'ethereum',
        address: '0xa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(result.results).toHaveLength(1);
    });

    it('sums analyzedCount across all fulfilled wallet fetches regardless of cross-set matches', async () => {
      // Two fulfilled wallets: first returns 100 txs, second returns 50 txs.
      // analyzedCount must be 150 even if 0 of those txs cross the two sides.
      const makeTxs = (count: number, from: string) =>
        Array.from({ length: count }, (_, i) =>
          mockTxResult({ txHash: `0x${from}${i}`, from, to: '0xunrelated' }),
        );

      mockBlockchainService.fetchHistory
        .mockResolvedValueOnce({ transactions: makeTxs(100, '0xa1'), chain: 'ethereum', address: '0xa1' })
        .mockResolvedValueOnce({ transactions: makeTxs(50, '0xa2'), chain: 'ethereum', address: '0xa2' });

      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1', '0xa2'] },
        sideB: { wallets: ['0xb1', '0xb2', '0xb3'] }, // B is larger, so A is fetched
        chain: 'ethereum',
      });

      expect(result.analyzedCount).toBe(150);
      // Cross-set filter: none of the txs flow between A and B sets, so 0 results
      expect(result.results).toHaveLength(0);
    });
  });
});
