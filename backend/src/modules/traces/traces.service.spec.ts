import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TracesService } from './traces.service';
import { TraceEntity } from '../../database/entities/trace.entity';
import { InvestigationEntity } from '../../database/entities/investigation.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { BlockchainService, TransactionResult } from '../blockchain/blockchain.service';
import { WalletSetDto } from './dto/search-between.dto';
import { edgeIdentityKey } from '../../generated/shared/edge-identity';

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
  assertRole: jest.fn(),
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

  // ── Editor role enforcement on mutations ─────────────────────────────────
  // Each mutation method must call assertRole with 'editor'. Verify by
  // checking the mock after a happy-path invocation.

  describe('editor role enforcement', () => {
    beforeEach(() => {
      mockTraceRepo.findOneBy.mockResolvedValue(structuredClone(traceWithData));
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));
      mockTraceRepo.remove.mockResolvedValue(undefined);
      mockTraceRepo.find.mockResolvedValue([structuredClone(traceWithData)]);
      mockTraceRepo.create.mockImplementation((args) => ({ ...args }));
    });

    it('create calls assertRole with editor', async () => {
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      await service.create(INV_ID, { name: 'T' }, PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('update calls assertRole with editor', async () => {
      await service.update('trace-1', { name: 'X' }, PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('remove calls assertRole with editor', async () => {
      await service.remove('trace-1', PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('updateNode calls assertRole with editor', async () => {
      await service.updateNode('trace-1', 'n1', { label: 'X' }, PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('updateEdge calls assertRole with editor', async () => {
      await service.updateEdge('trace-1', 'e1', { label: 'X' }, PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('deleteNode calls assertRole with editor', async () => {
      await service.deleteNode('trace-1', 'n1', PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('deleteEdge calls assertRole with editor', async () => {
      await service.deleteEdge('trace-1', 'e1', PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('createEdgeBundle calls assertRole with editor', async () => {
      // createEdgeBundle validates node/edge ids against investigation graph — wire repo.find
      mockTraceRepo.find.mockResolvedValue([structuredClone(traceWithData)]);
      await service.createEdgeBundle('trace-1', {
        fromNodeId: 'n1',
        toNodeId: 'n2',
        token: 'ETH',
        edgeIds: ['e1'],
      }, PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });

    it('importTransactions calls assertRole with editor', async () => {
      await service.importTransactions('trace-1', { transactions: [] }, PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'editor');
    });
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

    it('checks access via assertRole with the principal', async () => {
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue([]);

      await service.findAllForInvestigation(INV_ID, PRINCIPAL);

      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'viewer');
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

    it('checks access via assertRole with the principal', async () => {
      mockTraceRepo.findOneBy.mockResolvedValue(baseTrace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);

      await service.findOne('trace-1', PRINCIPAL);

      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(PRINCIPAL, CASE_ID, 'viewer');
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

  // ── importTransactions ───────────────────────────────────────────────────

  describe('importTransactions', () => {
    const importTraceFixture = () =>
      ({
        id: 'trace-1',
        name: 'Main Trace',
        investigationId: INV_ID,
        data: {
          nodes: [
            { id: 'n1', address: '0xaaa', chain: 'ethereum', label: 'A' },
            { id: 'n2', address: '0xbbb', chain: 'ethereum', label: 'B' },
          ],
          edges: [
            { id: 'e1', from: 'n1', to: 'n2', txHash: '0xtx1', chain: 'ethereum' },
          ],
        },
      }) as unknown as TraceEntity;

    it('a second import of an already-imported transaction adds 0 nodes and 0 edges', async () => {
      const trace = structuredClone(importTraceFixture());
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      // Sibling-trace lookup for cross-trace address resolution — self is excluded inside the service.
      mockTraceRepo.find.mockResolvedValue([trace]);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: '0xAAA',
              to: '0xBBB',
              txHash: '0xtx1',
              chain: 'ethereum',
              timestamp: '2024-01-01T00:00:00.000Z',
              amount: '1',
              token: 'ETH',
            },
          ],
        } as any,
        PRINCIPAL,
      );

      expect(result.added).toEqual({ nodes: 0, edges: 0 });
    });

    it('imports a genuinely new transaction — adds the missing node and the edge', async () => {
      const trace = structuredClone(importTraceFixture());
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue([trace]);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      const result = await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: '0xbbb',
              to: '0xccc',
              txHash: '0xtx2',
              chain: 'ethereum',
              timestamp: '2024-01-01T00:00:00.000Z',
              amount: '2',
              token: 'ETH',
            },
          ],
        } as any,
        PRINCIPAL,
      );

      expect(result.added).toEqual({ nodes: 1, edges: 1 });
      const savedData = mockTraceRepo.save.mock.calls[0][0].data;
      expect(savedData.nodes).toHaveLength(3);
      expect(savedData.edges).toHaveLength(2);
    });

    it('builds a structured EVM token from tokenMeta — amount stays raw base units', async () => {
      const trace = structuredClone(importTraceFixture());
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue([trace]);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: '0xbbb',
              to: '0xccc',
              txHash: '0xtx2',
              chain: 'ethereum',
              timestamp: '2024-01-01T00:00:00.000Z',
              amount: '1500000000000000000',
              token: 'ETH',
              tokenMeta: { address: '', decimals: 18 },
            },
          ],
        } as any,
        PRINCIPAL,
      );

      const savedData = mockTraceRepo.save.mock.calls[0][0].data;
      const edge = savedData.edges.find((e: any) => e.txHash === '0xtx2');
      expect(edge.token).toEqual({ address: '', symbol: 'ETH', decimals: 18 });
      expect(edge.amount).toBe('1500000000000000000');
    });

    it('leaves the token a bare string when tokenMeta is absent (MCP agent contract, unchanged)', async () => {
      const trace = structuredClone(importTraceFixture());
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue([trace]);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));

      await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: '0xbbb',
              to: '0xccc',
              txHash: '0xtx2',
              chain: 'ethereum',
              timestamp: '2024-01-01T00:00:00.000Z',
              // Human-readable ETH, no tokenMeta — the MCP agent shape.
              amount: '1.5',
              token: 'ETH',
            },
          ],
        } as any,
        PRINCIPAL,
      );

      const savedData = mockTraceRepo.save.mock.calls[0][0].data;
      const edge = savedData.edges.find((e: any) => e.txHash === '0xtx2');
      expect(edge.token).toBe('ETH');
      expect(edge.amount).toBe('1.5');
    });
  });

  // ── importTransactions: Bitcoin ──────────────────────────────────────────
  //
  // BTC rows carry a `utxo` block. Junction-flagged rows materialize a node
  // standing for the transaction itself plus one leg edge per real participant;
  // plain rows keep the full ledger record on the edge. Both dedup on the
  // txid-derived identity rather than on endpoint addresses.

  describe('importTransactions (bitcoin)', () => {
    const TXID = 'e3f1c0a9b8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1';
    const IN_1 = 'bc1qspenderoneaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const IN_2 = 'bc1qspendertwobbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const OUT_1 = 'bc1qrecipientccccccccccccccccccccccccccccc';
    const CHANGE = 'bc1qchangedddddddddddddddddddddddddddddddd';

    const emptyTrace = () =>
      ({
        id: 'trace-1',
        name: 'BTC Trace',
        investigationId: INV_ID,
        data: { nodes: [], edges: [] },
      }) as unknown as TraceEntity;

    /** 3 inputs (index 0 coinbase) / 3 outputs (vout 1 OP_RETURN) → 2 + 2 legs. */
    const junctionUtxo = () => ({
      inputs: [
        { address: null, value: '625000000', prevTxid: '0'.repeat(64), prevVout: 4294967295, coinbase: true },
        { address: IN_1, value: '100000', prevTxid: 'aa'.repeat(32), prevVout: 0 },
        { address: IN_2, value: '200000', prevTxid: 'bb'.repeat(32), prevVout: 1 },
      ],
      outputs: [
        { address: OUT_1, value: '150000', index: 0 },
        { address: null, value: '0', index: 1, opReturn: true },
        { address: CHANGE, value: '140000', index: 2, change: true, changeEvidence: ['reused input address'] },
      ],
      fee: '10000',
      warnings: ['consolidation'],
      confirmed: true,
      blockHeight: 800000,
      // Per-ROW fields: this row happens to describe vout 0 of the transaction.
      vout: 0,
      junction: true,
    });

    const junctionTx = (overrides: Record<string, any> = {}) => ({
      from: IN_1,
      to: OUT_1,
      txHash: TXID,
      chain: 'bitcoin',
      timestamp: '2024-06-01T00:00:00.000Z',
      amount: '150000',
      token: 'BTC',
      blockNumber: 800000,
      utxo: junctionUtxo(),
      ...overrides,
    });

    /** Wire the repo mocks against a single mutable trace so re-imports see prior state. */
    const wire = (trace: TraceEntity) => {
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue([trace]);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));
    };

    const lastSaved = () =>
      mockTraceRepo.save.mock.calls[mockTraceRepo.save.mock.calls.length - 1][0].data as {
        nodes: any[];
        edges: any[];
      };

    /** Recompute each stored edge's identity the way importTransactions does. */
    const storedEdgeKeys = (data: { nodes: any[]; edges: any[] }) => {
      const byId = new Map<string, string>(data.nodes.map((n) => [n.id, n.address]));
      return data.edges.map((e) =>
        edgeIdentityKey(e, byId.get(e.from) ?? e.from, byId.get(e.to) ?? e.to),
      );
    };

    it('materializes a junction node and one leg per real participant', async () => {
      const trace = emptyTrace();
      wire(trace);

      const result = await service.importTransactions(
        'trace-1',
        { transactions: [junctionTx()] } as any,
        PRINCIPAL,
      );

      // 1 junction + 2 input addresses + 2 output addresses (coinbase input and
      // OP_RETURN output produce no node).
      expect(result.added).toEqual({ nodes: 5, edges: 4 });

      const data = lastSaved();
      const junctions = data.nodes.filter((n) => n.kind === 'txJunction');
      expect(junctions).toHaveLength(1);
      const junction = junctions[0];
      expect(junction.address).toBe(TXID);
      expect(junction.label).toBe('3 in / 3 out');
      expect(junction.chain).toBe('bitcoin');
      expect(junction.explorerUrl).toBe(`https://mempool.space/tx/${TXID}`);
      expect(junction.addressType).toBe('unknown');
      expect(junction.parentTrace).toBe('trace-1');
    });

    it('stores the full ledger record once on the junction node, stripped of per-row fields', async () => {
      const trace = emptyTrace();
      wire(trace);
      const payload = junctionTx();

      await service.importTransactions('trace-1', { transactions: [payload] } as any, PRINCIPAL);

      const junction = lastSaved().nodes.find((n) => n.kind === 'txJunction')!;
      expect(junction.utxoTx.inputs).toHaveLength(3);
      expect(junction.utxoTx.outputs).toHaveLength(3);
      expect(junction.utxoTx.fee).toBe('10000');
      expect(junction.utxoTx.warnings).toEqual(['consolidation']);
      expect(junction.utxoTx.confirmed).toBe(true);
      expect(junction.utxoTx.blockHeight).toBe(800000);

      // vout/legType/legIndex/junction describe the ROW, not the transaction.
      expect(junction.utxoTx).not.toHaveProperty('vout');
      expect(junction.utxoTx).not.toHaveProperty('junction');
      expect(junction.utxoTx).not.toHaveProperty('legType');
      expect(junction.utxoTx).not.toHaveProperty('legIndex');

      // The request's arrays are shared by reference with sibling rows — the
      // persisted graph must not alias them.
      expect(junction.utxoTx.inputs).not.toBe(payload.utxo.inputs);
      expect(junction.utxoTx.outputs).not.toBe(payload.utxo.outputs);
    });

    it('keys input legs by txid:in:<original index> and output legs by txid:<vout>', async () => {
      const trace = emptyTrace();
      wire(trace);

      await service.importTransactions('trace-1', { transactions: [junctionTx()] } as any, PRINCIPAL);

      const data = lastSaved();
      // Input legs keep the ORIGINAL input index — the coinbase at 0 is skipped,
      // so the legs are 1 and 2, never 0 and 1.
      expect(storedEdgeKeys(data).sort()).toEqual(
        [`${TXID}:in:1`, `${TXID}:in:2`, `${TXID}:0`, `${TXID}:2`].sort(),
      );

      const junctionId = data.nodes.find((n) => n.kind === 'txJunction')!.id;
      const addrOf = new Map<string, string>(data.nodes.map((n) => [n.id, n.address]));

      const inputLegs = data.edges.filter((e) => e.utxo.legType === 'input');
      expect(inputLegs.every((e) => e.to === junctionId)).toBe(true);
      expect(inputLegs.map((e) => addrOf.get(e.from)).sort()).toEqual([IN_1, IN_2].sort());
      expect(inputLegs.map((e) => e.amount).sort()).toEqual(['100000', '200000'].sort());

      const outputLegs = data.edges.filter((e) => e.utxo.legType === 'output');
      expect(outputLegs.every((e) => e.from === junctionId)).toBe(true);
      expect(outputLegs.map((e) => addrOf.get(e.to)).sort()).toEqual([OUT_1, CHANGE].sort());
    });

    it('gives leg edges a slim utxo block — the ledger record is not duplicated per leg', async () => {
      const trace = emptyTrace();
      wire(trace);

      await service.importTransactions('trace-1', { transactions: [junctionTx()] } as any, PRINCIPAL);

      const data = lastSaved();
      const inputLeg = data.edges.find((e) => e.utxo.legType === 'input')!;
      expect(inputLeg.utxo).toEqual({ inputs: [], outputs: [], fee: '', legType: 'input', legIndex: expect.any(Number) });

      // The change output's leg describes ITS OWN output — a single-entry
      // outputs array — so the change verdict survives on the edge.
      const changeLeg = data.edges.find((e) => e.utxo.vout === 2)!;
      expect(changeLeg.utxo).toEqual({
        inputs: [],
        outputs: [{ address: CHANGE, value: '140000', index: 2, change: true }],
        fee: '',
        legType: 'output',
        vout: 2,
      });

      const paymentLeg = data.edges.find((e) => e.utxo.vout === 0)!;
      expect(paymentLeg.utxo.outputs).toEqual([{ address: OUT_1, value: '150000', index: 0 }]);
    });

    it('writes the structured BTC token on every leg (amounts are satoshis)', async () => {
      const trace = emptyTrace();
      wire(trace);

      await service.importTransactions('trace-1', { transactions: [junctionTx()] } as any, PRINCIPAL);

      for (const edge of lastSaved().edges) {
        expect(edge.token).toEqual({ address: '', symbol: 'BTC', decimals: 8 });
      }
    });

    it('re-importing the same junction payload adds 0 nodes and 0 edges', async () => {
      const trace = emptyTrace();
      wire(trace);

      await service.importTransactions('trace-1', { transactions: [junctionTx()] } as any, PRINCIPAL);
      const second = await service.importTransactions(
        'trace-1',
        { transactions: [junctionTx()] } as any,
        PRINCIPAL,
      );

      expect(second.added).toEqual({ nodes: 0, edges: 0 });
      const data = lastSaved();
      expect(data.nodes).toHaveLength(5);
      expect(data.edges).toHaveLength(4);
    });

    it('collapses every row of one junction transaction onto a single node and leg set', async () => {
      const trace = emptyTrace();
      wire(trace);

      // The normalizer emits one row per payable output, each carrying the SAME
      // full context — planning from any of them must converge.
      const result = await service.importTransactions(
        'trace-1',
        {
          transactions: [
            junctionTx(),
            junctionTx({ to: CHANGE, amount: '140000', utxo: { ...junctionUtxo(), vout: 2 } }),
          ],
        } as any,
        PRINCIPAL,
      );

      expect(result.added).toEqual({ nodes: 5, edges: 4 });
    });

    it('keeps the full utxo payload on a direct (non-junction) BTC edge and dedups on txid:vout', async () => {
      const trace = emptyTrace();
      wire(trace);

      const directTx = (labels: Record<string, string> = {}) => ({
        from: IN_1,
        to: OUT_1,
        txHash: TXID,
        chain: 'bitcoin',
        timestamp: '2024-06-01T00:00:00.000Z',
        amount: '150000',
        token: 'BTC',
        blockNumber: 800000,
        utxo: {
          inputs: [{ address: IN_1, value: '160000', prevTxid: 'aa'.repeat(32), prevVout: 0 }],
          outputs: [{ address: OUT_1, value: '150000', index: 0 }],
          fee: '10000',
          confirmed: true,
          vout: 0,
        },
        ...labels,
      });

      const first = await service.importTransactions(
        'trace-1',
        { transactions: [directTx()] } as any,
        PRINCIPAL,
      );
      expect(first.added).toEqual({ nodes: 2, edges: 1 });

      const edge = lastSaved().edges[0];
      expect(edge.utxo.inputs).toHaveLength(1);
      expect(edge.utxo.outputs).toHaveLength(1);
      expect(edge.utxo.fee).toBe('10000');
      expect(edge.utxo.vout).toBe(0);
      expect(edge.token).toEqual({ address: '', symbol: 'BTC', decimals: 8 });

      // Identity is txid:vout, so relabeled endpoints are still the same fact.
      const second = await service.importTransactions(
        'trace-1',
        { transactions: [directTx({ fromLabel: 'Exchange hot wallet', toLabel: 'Suspect' })] } as any,
        PRINCIPAL,
      );
      expect(second.added).toEqual({ nodes: 0, edges: 0 });
    });

    it('leaves the token a bare string on a BTC row that carries no utxo provenance', async () => {
      const trace = emptyTrace();
      wire(trace);

      await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: IN_1,
              to: OUT_1,
              txHash: TXID,
              chain: 'bitcoin',
              timestamp: '2024-06-01T00:00:00.000Z',
              // Human-readable BTC, not satoshis — the legacy import shape.
              amount: '0.0015',
              token: 'BTC',
            },
          ],
        } as any,
        PRINCIPAL,
      );

      const edge = lastSaved().edges[0];
      expect(edge.token).toBe('BTC');
      expect(edge).not.toHaveProperty('utxo');
    });

    it('persists base58 addresses with case intact while still matching a differently-cased re-import', async () => {
      const trace = emptyTrace();
      wire(trace);
      const BASE58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

      const row = (to: string) => ({
        from: IN_1,
        to,
        txHash: TXID,
        chain: 'bitcoin',
        timestamp: '2024-06-01T00:00:00.000Z',
        amount: '150000',
        token: 'BTC',
        utxo: {
          inputs: [{ address: IN_1, value: '160000', prevTxid: 'aa'.repeat(32), prevVout: 0 }],
          outputs: [{ address: to, value: '150000', index: 0 }],
          fee: '10000',
          vout: 0,
        },
      });

      await service.importTransactions('trace-1', { transactions: [row(BASE58)] } as any, PRINCIPAL);
      const stored = lastSaved().nodes.find((n) => n.address !== IN_1)!;
      // Lowercasing a base58 address destroys it — the persisted value is verbatim.
      expect(stored.address).toBe(BASE58);
      expect(stored.explorerUrl).toBe(`https://mempool.space/address/${BASE58}`);

      // ...but the lookup maps are case-insensitive, so a sloppy re-spelling
      // resolves to the same node instead of minting a duplicate.
      const second = await service.importTransactions(
        'trace-1',
        { transactions: [row(BASE58.toLowerCase())] } as any,
        PRINCIPAL,
      );
      expect(second.added).toEqual({ nodes: 0, edges: 0 });
    });

    it('regression: a whitespace-padded address resolves to the SAME node as its bare spelling', async () => {
      const trace = emptyTrace();
      wire(trace);
      const BASE58 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';

      // The persisted value is trimmed (normalizeAddressForChain), so a lookup
      // key that did not also trim put these two spellings under different keys
      // and minted two nodes with byte-identical stored addresses.
      const row = (to: string, vout: number) => ({
        from: IN_1,
        to,
        txHash: TXID,
        chain: 'bitcoin',
        timestamp: '2024-06-01T00:00:00.000Z',
        amount: '150000',
        token: 'BTC',
        utxo: {
          inputs: [{ address: IN_1, value: '310000', prevTxid: 'aa'.repeat(32), prevVout: 0 }],
          outputs: [{ address: to, value: '150000', index: vout }],
          fee: '10000',
          vout,
        },
      });

      const result = await service.importTransactions(
        'trace-1',
        { transactions: [row(`  ${BASE58}  `, 0), row(BASE58, 1)] } as any,
        PRINCIPAL,
      );

      // IN_1 + the recipient, counted ONCE across both spellings.
      expect(result.added).toEqual({ nodes: 2, edges: 2 });

      const data = lastSaved();
      const recipients = data.nodes.filter((n) => n.address === BASE58);
      expect(recipients).toHaveLength(1);
      // ...and it is stored trimmed, not with the padding it arrived with.
      expect(data.nodes.map((n) => n.address).sort()).toEqual([BASE58, IN_1].sort());

      // Both edges must land on that one node — a partially-trimmed key would
      // have failed the endpoint lookup and dropped an edge instead.
      expect(data.edges).toHaveLength(2);
      expect(data.edges.map((e) => e.to)).toEqual([recipients[0].id, recipients[0].id]);
    });

    it('imports a mixed EVM + BTC payload without cross-contamination', async () => {
      const trace = emptyTrace();
      wire(trace);

      const result = await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: '0xAAA',
              to: '0xBBB',
              txHash: '0xtx1',
              chain: 'ethereum',
              timestamp: '2024-01-01T00:00:00.000Z',
              amount: '1',
              token: 'ETH',
            },
            junctionTx(),
          ],
        } as any,
        PRINCIPAL,
      );

      // 2 EVM wallets + 1 junction + 4 BTC addresses; 1 EVM edge + 4 legs.
      expect(result.added).toEqual({ nodes: 7, edges: 5 });

      const data = lastSaved();
      const evmEdge = data.edges.find((e) => e.chain === 'ethereum')!;
      // EVM rows are untouched by the BTC path: string token, no utxo block.
      expect(evmEdge.token).toBe('ETH');
      expect(evmEdge).not.toHaveProperty('utxo');

      const evmNode = data.nodes.find((n) => n.address === '0xAAA')!;
      // EVM addresses persist exactly as imported (unchanged legacy behavior).
      expect(evmNode.address).toBe('0xAAA');
      expect(evmNode.explorerUrl).toBe('https://etherscan.io/address/0xAAA');
      expect(evmNode).not.toHaveProperty('kind');
    });
  });

  // ── importTransactions: Solana ───────────────────────────────────────────
  //
  // Solana rows are ordinary account-model transfers — there is no junction
  // concept (that's Bitcoin-only). One signature can carry several transfers
  // (native SOL + SPL legs); `solana.transferIndex` is what edgeIdentityKey()
  // uses to give each its own identity. Context-carrying rows rebuild a
  // structured token object from `item.solana`; bare rows (no context) keep
  // the legacy string-token behavior.

  describe('importTransactions (solana)', () => {
    const SIG = '5VfYmGVKNTJ8mYPo9pmbQiPmqSXcCUw7ZTKz9NKM1qXJj9v5o9j1KDb8QwzuvGqvvbPd9Mo7sSYtMzQKzYVFtqvL';
    const FROM = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
    const TO = 'FEUSSJ8LhqQiFgWkFbT8b7hswXCJhZfoq3HzTYcMANZG';
    const TO2 = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    const emptyTrace = () =>
      ({
        id: 'trace-1',
        name: 'Solana Trace',
        investigationId: INV_ID,
        data: { nodes: [], edges: [] },
      }) as unknown as TraceEntity;

    /** Wire the repo mocks against a single mutable trace so re-imports see prior state. */
    const wire = (trace: TraceEntity) => {
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.find.mockResolvedValue([trace]);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));
    };

    const lastSaved = () =>
      mockTraceRepo.save.mock.calls[mockTraceRepo.save.mock.calls.length - 1][0].data as {
        nodes: any[];
        edges: any[];
      };

    const nativeTransfer = (overrides: Record<string, any> = {}) => ({
      from: FROM,
      to: TO,
      txHash: SIG,
      chain: 'solana',
      timestamp: '2024-06-01T00:00:00.000Z',
      amount: '1000000000',
      token: 'SOL',
      blockNumber: 12345,
      solana: {
        transferIndex: 0,
        feePayer: FROM,
        kind: 'native' as const,
        slot: 12345,
      },
      ...overrides,
    });

    const splTransfer = (overrides: Record<string, any> = {}) => ({
      from: FROM,
      to: TO,
      txHash: SIG,
      chain: 'solana',
      timestamp: '2024-06-01T00:00:00.000Z',
      amount: '500000',
      token: 'USDC',
      blockNumber: 12345,
      solana: {
        transferIndex: 1,
        feePayer: FROM,
        kind: 'spl' as const,
        mint: USDC_MINT,
        decimals: 6,
        fromTokenAccount: 'tokenAcctFrom111111111111111111111111111',
        toTokenAccount: 'tokenAcctTo1111111111111111111111111111111',
      },
      ...overrides,
    });

    it('imports two transfers from one signature — transferIndex 0/1, distinct counterparties — as 2 edges with distinct identities', async () => {
      const trace = emptyTrace();
      wire(trace);

      const result = await service.importTransactions(
        'trace-1',
        { transactions: [nativeTransfer(), splTransfer({ to: TO2 })] } as any,
        PRINCIPAL,
      );

      expect(result.added.edges).toBe(2);
      const data = lastSaved();
      expect(data.edges).toHaveLength(2);
      const byId = new Map<string, string>(data.nodes.map((n) => [n.id, n.address]));
      const keys = data.edges.map((e) =>
        edgeIdentityKey(e, byId.get(e.from) ?? e.from, byId.get(e.to) ?? e.to),
      );
      expect(keys.sort()).toEqual([`${SIG}:sol:0`, `${SIG}:sol:1`].sort());
    });

    it('re-importing the same payload adds 0 nodes and 0 edges', async () => {
      const trace = emptyTrace();
      wire(trace);
      const payload = { transactions: [nativeTransfer(), splTransfer({ to: TO2 })] } as any;

      await service.importTransactions('trace-1', payload, PRINCIPAL);
      const second = await service.importTransactions('trace-1', payload, PRINCIPAL);

      expect(second.added).toEqual({ nodes: 0, edges: 0 });
    });

    it('rebuilds the structured token object from solana context — SPL and native', async () => {
      const trace = emptyTrace();
      wire(trace);

      await service.importTransactions(
        'trace-1',
        { transactions: [nativeTransfer(), splTransfer({ to: TO2 })] } as any,
        PRINCIPAL,
      );

      const data = lastSaved();
      const nativeEdge = data.edges.find((e) => e.solana.kind === 'native')!;
      expect(nativeEdge.token).toEqual({ address: '', symbol: 'SOL', decimals: 9 });

      const splEdge = data.edges.find((e) => e.solana.kind === 'spl')!;
      expect(splEdge.token).toEqual({ address: USDC_MINT, symbol: 'USDC', decimals: 6 });
    });

    it('persists the full solana context, including spam/spamEvidence, on the written edge', async () => {
      const trace = emptyTrace();
      wire(trace);
      const item = splTransfer({
        to: TO2,
        solana: {
          ...splTransfer().solana,
          spam: true,
          spamEvidence: ['unsolicited', 'unknown-mint'],
        },
      });

      await service.importTransactions('trace-1', { transactions: [item] } as any, PRINCIPAL);

      const edge = lastSaved().edges[0];
      expect(edge.solana).toEqual(item.solana);
    });

    it('persists a case-sensitive solana address with case intact but dedups it case-insensitively via addressKey', async () => {
      const trace = emptyTrace();
      wire(trace);
      const MIXED = TO;

      await service.importTransactions(
        'trace-1',
        { transactions: [nativeTransfer({ to: MIXED })] } as any,
        PRINCIPAL,
      );
      const second = await service.importTransactions(
        'trace-1',
        {
          transactions: [
            splTransfer({
              to: MIXED.toLowerCase(),
              txHash: `${SIG}b`,
              solana: { ...splTransfer().solana, transferIndex: 0 },
            }),
          ],
        } as any,
        PRINCIPAL,
      );

      const data = lastSaved();
      const stored = data.nodes.filter((n) => n.address.toLowerCase() === MIXED.toLowerCase());
      expect(stored).toHaveLength(1);
      expect(stored[0].address).toBe(MIXED);
      // Second import's `to` resolves to the SAME node — 0 new nodes.
      expect(second.added.nodes).toBe(0);
    });

    it('imports a mixed EVM + Solana payload without cross-contamination', async () => {
      const trace = emptyTrace();
      wire(trace);

      const result = await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: '0xAAA',
              to: '0xBBB',
              txHash: '0xtx1',
              chain: 'ethereum',
              timestamp: '2024-01-01T00:00:00.000Z',
              amount: '1',
              token: 'ETH',
            },
            nativeTransfer(),
          ],
        } as any,
        PRINCIPAL,
      );

      expect(result.added).toEqual({ nodes: 4, edges: 2 });
      const data = lastSaved();
      const evmEdge = data.edges.find((e) => e.chain === 'ethereum')!;
      expect(evmEdge.token).toBe('ETH');
      expect(evmEdge).not.toHaveProperty('solana');

      const solEdge = data.edges.find((e) => e.chain === 'solana')!;
      expect(solEdge.token).toEqual({ address: '', symbol: 'SOL', decimals: 9 });
      expect(solEdge.solana.kind).toBe('native');
    });

    it('leaves the token a bare string on a solana row with no context (legacy behavior unchanged)', async () => {
      const trace = emptyTrace();
      wire(trace);

      await service.importTransactions(
        'trace-1',
        {
          transactions: [
            {
              from: FROM,
              to: TO,
              txHash: SIG,
              chain: 'solana',
              timestamp: '2024-06-01T00:00:00.000Z',
              // Human-readable SOL, not lamports — the legacy import shape.
              amount: '1.5',
              token: 'SOL',
            },
          ],
        } as any,
        PRINCIPAL,
      );

      const edge = lastSaved().edges[0];
      expect(edge.token).toBe('SOL');
      expect(edge).not.toHaveProperty('solana');
    });

    it('regression: a whitespace-padded solana address resolves to the SAME node as its bare spelling', async () => {
      const trace = emptyTrace();
      wire(trace);
      const ADDR = TO;

      const row = (to: string, txHash: string) => ({
        from: FROM,
        to,
        txHash,
        chain: 'solana',
        timestamp: '2024-06-01T00:00:00.000Z',
        amount: '1000000000',
        token: 'SOL',
        solana: { transferIndex: 0, feePayer: FROM, kind: 'native' as const },
      });

      const result = await service.importTransactions(
        'trace-1',
        { transactions: [row(`  ${ADDR}  `, SIG), row(ADDR, `${SIG}b`)] } as any,
        PRINCIPAL,
      );

      // FROM + ADDR, counted once across both spellings.
      expect(result.added.nodes).toBe(2);
      const data = lastSaved();
      const recipients = data.nodes.filter((n) => n.address === ADDR);
      expect(recipients).toHaveLength(1);
    });

    it('F3: skips the entire row (no nodes, no edge) for a solana item with an empty endpoint, unlike bitcoin', async () => {
      const trace = emptyTrace();
      wire(trace);

      const result = await service.importTransactions(
        'trace-1',
        { transactions: [nativeTransfer({ from: '' })] } as any,
        PRINCIPAL,
      );

      expect(result.added).toEqual({ nodes: 0, edges: 0 });
      const data = lastSaved();
      expect(data.nodes).toHaveLength(0);
      expect(data.edges).toHaveLength(0);
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
      nodes?: Array<{ id: string; address: string; chain: string; groupId?: string; kind?: string }>;
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

    it('excludes txJunction nodes from a group (their address is a txid, not a wallet)', () => {
      const walletAddr = 'bc1qwalletaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const trace = makeFakeTrace({
        groups: [{ id: 'g1', name: 'A', color: '#000', traceId: 'fake-trace' }],
        nodes: [
          { id: 'n1', address: walletAddr, chain: 'bitcoin', groupId: 'g1' },
          { id: 'n2', address: 'deadbeef'.repeat(8), chain: 'bitcoin', groupId: 'g1', kind: 'txJunction' },
        ],
      });
      const set = service.resolveWalletSet([trace], { groupId: 'g1' } as WalletSetDto, 'bitcoin');
      expect([...set]).toEqual([walletAddr]);
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

    it('excludes txJunction nodes from a traceId set (their address is a txid, not a wallet)', () => {
      const walletAddr = 'bc1qwalletaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const trace = makeFakeTrace({
        id: 'trace-abc',
        nodes: [
          { id: 'n1', address: walletAddr, chain: 'bitcoin' },
          { id: 'n2', address: 'deadbeef'.repeat(8), chain: 'bitcoin', kind: 'txJunction' },
        ],
      });
      const set = service.resolveWalletSet([trace], { traceId: 'trace-abc' } as WalletSetDto, 'bitcoin');
      expect([...set]).toEqual([walletAddr]);
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

  // ── label validation ─────────────────────────────────────────────────────

  describe('label validation', () => {
    /** Seeds a fresh trace via mock — returns a plain object the update() call can read. */
    async function seedTrace() {
      const trace = { ...baseTrace, data: {} };
      mockTraceRepo.findOneBy.mockResolvedValue(trace);
      mockInvRepo.findOneBy.mockResolvedValue(investigation);
      mockTraceRepo.save.mockImplementation((e) => Promise.resolve(e));
      return trace;
    }

    it('accepts a trace update with valid labels', async () => {
      const trace = await seedTrace();
      await expect(
        service.update(trace.id, { data: { ...trace.data, labels: [{ id: 'l1', text: 'x', anchor: { type: 'free', x: 0, y: 0 } }] } }, PRINCIPAL),
      ).resolves.toBeDefined();
    });

    it('rejects a trace update with malformed labels', async () => {
      const trace = await seedTrace();
      await expect(
        service.update(trace.id, { data: { ...trace.data, labels: [{ text: 'oops' }] as any } }, PRINCIPAL),
      ).rejects.toThrow(/labels\[0\]/);
    });

    it('strips unknown fields on labels', async () => {
      const trace = await seedTrace();
      const out = await service.update(trace.id, { data: { ...trace.data, labels: [{ id: 'l1', text: 'x', anchor: { type: 'free', x: 0, y: 0 }, evil: 'x' } as any] } }, PRINCIPAL);
      expect((out.data as any).labels[0]).not.toHaveProperty('evil');
    });

    it('treats missing labels as empty', async () => {
      const trace = await seedTrace();
      const out = await service.update(trace.id, { data: { ...trace.data } }, PRINCIPAL);
      // labels is optional; if not present in the saved data, it's absent.
      expect((out.data as any).labels === undefined || Array.isArray((out.data as any).labels)).toBe(true);
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

    // ── Bitcoin guards (Task 15) ─────────────────────────────────────────

    it('uses maxTotal 300 for bitcoin (a wallet history can run into the tens of thousands of rows)', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'bitcoin',
        address: 'bc1qa1',
      });
      await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['bc1qa1'] },
        sideB: { wallets: ['bc1qb1'] },
        chain: 'bitcoin',
      });
      expect(mockBlockchainService.fetchHistory).toHaveBeenCalledWith(
        'bc1qa1',
        'bitcoin',
        expect.objectContaining({ maxTotal: 300 }),
      );
    });

    it("uses maxTotal 300 for solana (shares bitcoin's conservative cap)", async () => {
      const SOL_A = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
      const SOL_B = 'FEUSSJ8LhqQiFgWkFbT8b7hswXCJhZfoq3HzTYcMANZG';
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'solana',
        address: SOL_A,
      });
      await service.searchBetween(baseTraces(), {
        sideA: { wallets: [SOL_A] },
        sideB: { wallets: [SOL_B] },
        chain: 'solana',
      });
      expect(mockBlockchainService.fetchHistory).toHaveBeenCalledWith(
        SOL_A,
        'solana',
        expect.objectContaining({ maxTotal: 300 }),
      );
    });

    it('keeps maxTotal 10000 for EVM chains — unchanged from before the bitcoin guard', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'ethereum',
        address: '0xa1',
      });
      await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['0xa1'] },
        sideB: { wallets: ['0xb1'] },
        chain: 'ethereum',
      });
      expect(mockBlockchainService.fetchHistory).toHaveBeenCalledWith(
        '0xa1',
        'ethereum',
        expect.objectContaining({ maxTotal: 10000 }),
      );
    });

    it('keeps Tron maxTotal/offset byte-identical (2000 / 50) — unaffected by the bitcoin guard', async () => {
      const tronA = 'TEsCiXabcdefghijklmnopqrstuvwxyz12';
      const tronB = 'TKr41tABCDEFGHJKLMNPQRSTUVWXYZabcd';
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [],
        chain: 'tron',
        address: tronA,
      });
      await service.searchBetween(baseTraces(), {
        sideA: { wallets: [tronA] },
        sideB: { wallets: [tronB] },
        chain: 'tron',
      });
      expect(mockBlockchainService.fetchHistory).toHaveBeenCalledWith(
        tronA,
        'tron',
        expect.objectContaining({ maxTotal: 2000, offset: 50 }),
      );
    });

    it('carries structured EVM token metadata through search results — toImportItem populates tokenMeta', async () => {
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({
            txHash: '0x8',
            from: '0xa1',
            to: '0xb1',
            chain: 'ethereum',
            amount: '1500000000000000000',
            token: { address: '0xtokenaddr', symbol: 'USDC', decimals: 6 },
          }),
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
      expect(result.results[0].token).toBe('USDC');
      expect(result.results[0].tokenMeta).toEqual({ address: '0xtokenaddr', decimals: 6 });
    });

    it('retains the utxo block on bitcoin search results — toImportItem does not strip it', async () => {
      const utxo = {
        inputs: [{ address: 'bc1qa1', value: '160000', prevTxid: 'aa'.repeat(32), prevVout: 0 }],
        outputs: [{ address: 'bc1qb1', value: '150000', index: 0 }],
        fee: '10000',
        vout: 0,
      };
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({
            txHash: 'txid1',
            from: 'bc1qa1',
            to: 'bc1qb1',
            chain: 'bitcoin',
            amount: '150000',
            token: { address: '', symbol: 'BTC', decimals: 8 },
            utxo,
          }),
        ],
        chain: 'bitcoin',
        address: 'bc1qa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['bc1qa1'] },
        sideB: { wallets: ['bc1qb1'] },
        chain: 'bitcoin',
      });
      expect(result.results).toHaveLength(1);
      // Amount stays satoshis, token stays the bare 'BTC' string — reformatting
      // is importTransactions' job, not the search mapping's.
      expect(result.results[0].amount).toBe('150000');
      expect(result.results[0].token).toBe('BTC');
      expect(result.results[0].utxo).toEqual(utxo);
    });

    it('dedups BTC cross-set rows on edgeIdentityKey (txid:vout), not on endpoint addresses', async () => {
      const utxoFor = (vout: number) => ({
        inputs: [{ address: 'bc1qa1', value: '999999', prevTxid: 'aa'.repeat(32), prevVout: 0 }],
        outputs: [{ address: 'bc1qb1', value: '150000', index: vout }],
        fee: '10000',
        vout,
      });
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({
            txHash: 'txid1',
            from: 'bc1qa1',
            to: 'bc1qb1',
            chain: 'bitcoin',
            amount: '150000',
            token: { address: '', symbol: 'BTC', decimals: 8 },
            utxo: utxoFor(0),
          }),
          mockTxResult({
            txHash: 'txid1',
            from: 'bc1qa1',
            to: 'bc1qb1',
            chain: 'bitcoin',
            amount: '150000',
            token: { address: '', symbol: 'BTC', decimals: 8 },
            utxo: utxoFor(1),
          }),
        ],
        chain: 'bitcoin',
        address: 'bc1qa1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['bc1qa1'] },
        sideB: { wallets: ['bc1qb1'] },
        chain: 'bitcoin',
      });
      // Same (txHash, from, to) but two distinct outputs (vout 0 and vout 1) —
      // the old `${txHash}-${from}-${to}` key would have collapsed these into
      // one row and silently dropped a real payment.
      expect(result.results).toHaveLength(2);
    });

    it('matches an unattributed BTC incoming row (from "") when one of its inputs is in the other set', async () => {
      // The ledger names no single payer for this row (from: ''), but the
      // utxo carries every real input. A match on any input address against
      // the other side is a real cross-set link — the junction import draws
      // the real legs, so this must not be filtered out as a non-crossing tx.
      const utxo = {
        inputs: [
          { address: 'bc1qin1', value: '100000', prevTxid: 'aa'.repeat(32), prevVout: 0 },
          { address: 'bc1qin2', value: '200000', prevTxid: 'bb'.repeat(32), prevVout: 1 },
          { address: 'bc1qin3', value: '300000', prevTxid: 'cc'.repeat(32), prevVout: 2 },
        ],
        outputs: [{ address: 'bc1qb1', value: '580000', index: 0 }],
        fee: '20000',
        vout: 0,
      };
      mockBlockchainService.fetchHistory.mockResolvedValue({
        transactions: [
          mockTxResult({
            txHash: 'txid-unattributed',
            from: '',
            to: 'bc1qb1',
            chain: 'bitcoin',
            amount: '580000',
            token: { address: '', symbol: 'BTC', decimals: 8 },
            utxo,
          }),
        ],
        chain: 'bitcoin',
        address: 'bc1qb1',
      });
      const result = await service.searchBetween(baseTraces(), {
        sideA: { wallets: ['bc1qb1'] },
        sideB: { wallets: ['bc1qin2'] },
        chain: 'bitcoin',
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].txHash).toBe('txid-unattributed');
      expect(result.results[0].utxo).toEqual(utxo);
    });
  });
});
