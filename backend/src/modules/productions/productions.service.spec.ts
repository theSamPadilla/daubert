import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductionsService } from './productions.service';
import {
  ProductionEntity,
  ProductionType,
} from '../../database/entities/production.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { AccessPrincipal } from '../auth/access-principal';
import { seedChronologyData } from './chronology-schema';
import { seedDeclarationData, DeclarationData } from './declaration-data';
import { seedRedlineData, RedlineData } from './redline-data';
import { RedlineIngestService } from './redline-ingest.service';

const mockProductionRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockCaseAccess = {
  assertRole: jest.fn(),
};

const mockRedlineIngest = {
  buildData: jest.fn(),
};

const USER_PRINCIPAL: AccessPrincipal = { kind: 'user', userId: 'user-1' };
const SCRIPT_PRINCIPAL: AccessPrincipal = { kind: 'script', caseId: 'case-1', role: 'editor' };
const principal = USER_PRINCIPAL;

const makeProduction = (overrides: Partial<ProductionEntity> = {}): ProductionEntity =>
  ({
    id: 'prod-1',
    name: 'Test Report',
    type: ProductionType.REPORT,
    data: { content: '<h1>Hello</h1>' },
    caseId: 'case-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }) as ProductionEntity;

describe('ProductionsService', () => {
  let service: ProductionsService;
  // repo alias for tests that need to manipulate the mock directly
  const repo = mockProductionRepo;

  // Helper: create a seeded chronology production (data.columns populated) and
  // wire the mock repo so `findOneBy` returns it and `save` round-trips it.
  async function seedProd(overrides: Record<string, unknown> = {}): Promise<ProductionEntity> {
    const prod = makeProduction({
      type: ProductionType.CHRONOLOGY,
      data: seedChronologyData({ entries: [], ...overrides }) as unknown as Record<string, unknown>,
    });
    mockProductionRepo.findOneBy.mockResolvedValue(prod);
    mockProductionRepo.save.mockImplementation((p: ProductionEntity) => Promise.resolve({ ...p }));
    return prod;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ProductionsService,
        { provide: getRepositoryToken(ProductionEntity), useValue: mockProductionRepo },
        { provide: CaseAccessService, useValue: mockCaseAccess },
        { provide: RedlineIngestService, useValue: mockRedlineIngest },
      ],
    }).compile();

    service = module.get(ProductionsService);
  });

  // ── findAllForCase ──────────────────────────────────────────────────

  describe('findAllForCase', () => {
    it('returns productions for a case (user principal)', async () => {
      const productions = [makeProduction(), makeProduction({ id: 'prod-2' })];
      mockProductionRepo.find.mockResolvedValue(productions);

      const result = await service.findAllForCase('case-1', USER_PRINCIPAL);

      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1', 'viewer');
      expect(mockProductionRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'case-1' },
        order: { createdAt: 'ASC' },
      });
      expect(result).toEqual(productions);
    });

    it('accepts a script principal scoped to the same case', async () => {
      mockProductionRepo.find.mockResolvedValue([]);
      await service.findAllForCase('case-1', SCRIPT_PRINCIPAL);
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(SCRIPT_PRINCIPAL, 'case-1', 'viewer');
    });

    it('filters by type when provided', async () => {
      mockProductionRepo.find.mockResolvedValue([]);

      await service.findAllForCase('case-1', USER_PRINCIPAL, ProductionType.CHART);

      expect(mockProductionRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'case-1', type: ProductionType.CHART },
        order: { createdAt: 'ASC' },
      });
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns production and checks access', async () => {
      const production = makeProduction();
      mockProductionRepo.findOneBy.mockResolvedValue(production);

      const result = await service.findOne('prod-1', USER_PRINCIPAL);

      expect(mockProductionRepo.findOneBy).toHaveBeenCalledWith({ id: 'prod-1' });
      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1', 'viewer');
      expect(result).toEqual(production);
    });

    it('throws NotFoundException when not found', async () => {
      mockProductionRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('bad-id', USER_PRINCIPAL)).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      name: 'New Report',
      type: ProductionType.REPORT,
      data: { content: '' },
    };

    it('creates production for a case (user principal)', async () => {
      const created = makeProduction({ name: 'New Report', data: { content: '' } });
      mockProductionRepo.create.mockReturnValue(created);
      mockProductionRepo.save.mockResolvedValue(created);

      const result = await service.create('case-1', dto, USER_PRINCIPAL);

      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1', 'editor');
      expect(mockProductionRepo.create).toHaveBeenCalledWith({
        ...dto,
        caseId: 'case-1',
      });
      expect(result).toEqual(created);
    });

    it('accepts a script principal scoped to the same case', async () => {
      const created = makeProduction();
      mockProductionRepo.create.mockReturnValue(created);
      mockProductionRepo.save.mockResolvedValue(created);

      await service.create('case-1', dto, SCRIPT_PRINCIPAL);

      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(SCRIPT_PRINCIPAL, 'case-1', 'editor');
    });
  });

  // ── create() — chronology seeding ────────────────────────────────────

  describe('create() — chronology seeding', () => {
    beforeEach(() => {
      // Pass through: repo.create returns its argument, repo.save returns it
      mockProductionRepo.create.mockImplementation((obj: any) => ({ ...obj }));
      mockProductionRepo.save.mockImplementation((p: any) => Promise.resolve({ ...p }));
    });

    it('seeds default columns when none provided', async () => {
      const out = await service.create('case-1', {
        name: 'Test', type: ProductionType.CHRONOLOGY, data: { entries: [] },
      }, principal);
      expect((out.data as any).columns.map((c: any) => c.key)).toEqual(['source', 'date', 'description', 'details']);
    });

    it('normalizes seeded entries (legacy sourceUrl → source object)', async () => {
      const out = await service.create('case-1', {
        name: 'T', type: ProductionType.CHRONOLOGY, data: {
          entries: [{ sourceUrl: 'https://x', sourceLabel: 'X', date: '2025-01-01', description: 'd' }],
        },
      }, principal);
      expect((out.data as any).entries[0].source).toEqual({ url: 'https://x', label: 'X' });
    });

    it('handles undefined data', async () => {
      const out = await service.create('case-1', {
        name: 'T', type: ProductionType.CHRONOLOGY, data: undefined as any,
      }, principal);
      expect((out.data as any).columns).toBeDefined();
      expect((out.data as any).entries).toEqual([]);
    });

    it('does not touch non-chronology types', async () => {
      const out = await service.create('case-1', {
        name: 'R', type: ProductionType.REPORT, data: { content: '<p>x</p>' },
      }, principal);
      expect((out.data as any).columns).toBeUndefined();
    });
  });

  // ── create() — redline seeding ──────────────────────────────────────

  describe('create() — redline seeding', () => {
    beforeEach(() => {
      mockProductionRepo.create.mockImplementation((obj: any) => ({ ...obj }));
      mockProductionRepo.save.mockImplementation((p: any) => Promise.resolve({ ...p }));
    });

    it('seeds RedlineData built by RedlineIngestService.buildData', async () => {
      const seeded = seedRedlineData(
        {
          fileId: 'file-1',
          fileName: 'contract.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          kind: 'docx',
          extractedAt: '2026-01-01T00:00:00.000Z',
        },
        'Paragraph one.\n\nParagraph two.',
      );
      mockRedlineIngest.buildData.mockResolvedValue(seeded);

      const out = await service.create('case-1', {
        name: 'Redline', type: ProductionType.REDLINE, data: { sourceFileId: 'file-1' },
      }, USER_PRINCIPAL);

      expect(mockRedlineIngest.buildData).toHaveBeenCalledWith('case-1', 'file-1', 'user-1');
      const d = out.data as unknown as RedlineData;
      expect(d.source.kind).toBe('docx');
      expect(d.baseText).toBe('Paragraph one.\n\nParagraph two.');
      expect(d.edits).toEqual([]);
      expect(d.comments).toEqual([]);
    });

    it('rejects when data.sourceFileId is missing', async () => {
      await expect(service.create('case-1', {
        name: 'Redline', type: ProductionType.REDLINE, data: {},
      }, USER_PRINCIPAL)).rejects.toThrow(BadRequestException);
      expect(mockRedlineIngest.buildData).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when the source file is from another case', async () => {
      mockRedlineIngest.buildData.mockRejectedValue(new NotFoundException('file_not_found'));
      await expect(service.create('case-1', {
        name: 'Redline', type: ProductionType.REDLINE, data: { sourceFileId: 'file-1' },
      }, USER_PRINCIPAL)).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates production fields', async () => {
      const existing = makeProduction();
      const updated = { ...existing, name: 'Updated Name' };
      mockProductionRepo.findOneBy.mockResolvedValue(existing);
      mockProductionRepo.save.mockResolvedValue(updated);

      const result = await service.update('prod-1', { name: 'Updated Name' }, USER_PRINCIPAL);

      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1', 'editor');
      expect(mockProductionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name' }),
      );
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException for bad ID', async () => {
      mockProductionRepo.findOneBy.mockResolvedValue(null);

      await expect(service.update('bad-id', { name: 'X' }, USER_PRINCIPAL)).rejects.toThrow(
        NotFoundException,
      );
    });

    // ── chronology_set_row_highlight ──────────────────────────────────
    describe('chronology_set_row_highlight op', () => {
      const baseChronology = () =>
        makeProduction({
          type: ProductionType.CHRONOLOGY,
          data: {
            entries: [
              { date: '2026-01-01', description: 'a' },
              { date: '2026-01-02', description: 'b' },
              { date: '2026-01-03', description: 'c' },
            ],
          },
        });

      it('sets a highlight color on the given rows', async () => {
        const existing = baseChronology();
        mockProductionRepo.findOneBy.mockResolvedValue(existing);
        mockProductionRepo.save.mockImplementation((p) => Promise.resolve(p));

        await service.update(
          'prod-1',
          { ops: [{ op: 'chronology_set_row_highlight', indexes: [0, 2], color: 'red' }] },
          USER_PRINCIPAL,
        );

        const saved = mockProductionRepo.save.mock.calls[0][0];
        expect(saved.data.entries[0].highlight).toBe('red');
        expect(saved.data.entries[1].highlight).toBeUndefined();
        expect(saved.data.entries[2].highlight).toBe('red');
      });

      it('clears the highlight when color is null', async () => {
        const existing = makeProduction({
          type: ProductionType.CHRONOLOGY,
          data: {
            entries: [
              { date: 'd', description: 'x', highlight: 'gray' },
              { date: 'd', description: 'y', highlight: 'green' },
            ],
          },
        });
        mockProductionRepo.findOneBy.mockResolvedValue(existing);
        mockProductionRepo.save.mockImplementation((p) => Promise.resolve(p));

        await service.update(
          'prod-1',
          { ops: [{ op: 'chronology_set_row_highlight', indexes: [0], color: null }] },
          USER_PRINCIPAL,
        );

        const saved = mockProductionRepo.save.mock.calls[0][0];
        expect(saved.data.entries[0].highlight).toBeUndefined();
        expect(saved.data.entries[1].highlight).toBe('green');
      });

      it('rejects an unknown color', async () => {
        mockProductionRepo.findOneBy.mockResolvedValue(baseChronology());
        await expect(
          service.update(
            'prod-1',
            { ops: [{ op: 'chronology_set_row_highlight', indexes: [0], color: 'puce' }] },
            USER_PRINCIPAL,
          ),
        ).rejects.toThrow(/color.*yellow.*gray.*red.*green.*blue.*null/);
      });

      it('rejects an out-of-bounds index', async () => {
        mockProductionRepo.findOneBy.mockResolvedValue(baseChronology());
        await expect(
          service.update(
            'prod-1',
            { ops: [{ op: 'chronology_set_row_highlight', indexes: [99], color: 'red' }] },
            USER_PRINCIPAL,
          ),
        ).rejects.toThrow(/out of bounds/);
      });

      it('rejects an empty indexes array', async () => {
        mockProductionRepo.findOneBy.mockResolvedValue(baseChronology());
        await expect(
          service.update(
            'prod-1',
            { ops: [{ op: 'chronology_set_row_highlight', indexes: [], color: 'red' }] },
            USER_PRINCIPAL,
          ),
        ).rejects.toThrow(/non-empty array/);
      });

      it('rejects on a non-chronology production', async () => {
        mockProductionRepo.findOneBy.mockResolvedValue(makeProduction()); // REPORT
        await expect(
          service.update(
            'prod-1',
            { ops: [{ op: 'chronology_set_row_highlight', indexes: [0], color: 'red' }] },
            USER_PRINCIPAL,
          ),
        ).rejects.toThrow(/not "chronology"/);
      });
    });
  });

  // ── remove ───────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes production', async () => {
      const production = makeProduction();
      mockProductionRepo.findOneBy.mockResolvedValue(production);
      mockProductionRepo.remove.mockResolvedValue(production);

      await service.remove('prod-1', USER_PRINCIPAL);

      expect(mockCaseAccess.assertRole).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1', 'editor');
      expect(mockProductionRepo.remove).toHaveBeenCalledWith(production);
    });

    it('throws NotFoundException for bad ID', async () => {
      mockProductionRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('bad-id', USER_PRINCIPAL)).rejects.toThrow(NotFoundException);
    });
  });

  // ── chronology_set_column_widths (schema-driven) ──────────────────────

  describe('chronology_set_column_widths (schema-driven)', () => {
    it('updates width on matching column in data.columns', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_set_column_widths', widths: { source: 30 } }],
      }, principal);
      const cols = (out.data as any).columns;
      expect(cols.find((c: any) => c.key === 'source').width).toBe(30);
      expect(cols.find((c: any) => c.key === 'date').width).toBe(14);
    });

    it('handles multiple widths in one op', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_set_column_widths', widths: { source: 25, date: 20 } }],
      }, principal);
      const cols = (out.data as any).columns;
      expect(cols.find((c: any) => c.key === 'source').width).toBe(25);
      expect(cols.find((c: any) => c.key === 'date').width).toBe(20);
    });

    it('rejects unknown column key', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_set_column_widths', widths: { nonexistent: 10 } }],
      }, principal)).rejects.toThrow(/unknown column key/i);
    });

    it('rejects out-of-range widths', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_set_column_widths', widths: { source: 200 } }],
      }, principal)).rejects.toThrow(/between 5 and 80/);
    });

    it('strips legacy data.columnWidths if present', async () => {
      const prod = await seedProd();
      // Inject a legacy field via direct save (simulating un-migrated row):
      prod.data = { ...(prod.data as object), columnWidths: { source: 50 } } as any;
      await repo.save(prod);
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_set_column_widths', widths: { source: 25 } }],
      }, principal);
      expect((out.data as any).columnWidths).toBeUndefined();
    });
  });

  // ── chronology_append (entry normalization) ───────────────────────────

  describe('chronology_append (entry normalization)', () => {
    it('normalizes legacy sourceUrl + sourceLabel into entry.source', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_append', entries: [
          { sourceUrl: 'https://x', sourceLabel: 'X', date: '2025-01-01', description: 'd' },
        ]}],
      }, principal);
      const e = (out.data as any).entries[0];
      expect(e.source).toEqual({ url: 'https://x', label: 'X' });
      expect(e.sourceUrl).toBeUndefined();
      expect(e.sourceLabel).toBeUndefined();
    });

    it('preserves custom column keys (orphan-tolerant)', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_append', entries: [
          { date: '2025-01-01', description: 'd', notInColumns: 'orphan ok' },
        ]}],
      }, principal);
      expect((out.data as any).entries[0].notInColumns).toBe('orphan ok');
    });

    it('sets source: null when entry has no source info', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_append', entries: [
          { date: '2025-01-01', description: 'd' },
        ]}],
      }, principal);
      expect((out.data as any).entries[0].source).toBeNull();
    });
  });

  // ── chronology_replace (entry normalization) ──────────────────────────

  describe('chronology_replace (entry normalization)', () => {
    it('normalizes the replacement entry', async () => {
      const prod = await seedProd({
        entries: [{ source: { url: 'https://a', label: 'A' }, date: '2025-01-01', description: 'old' }],
      });
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_replace', index: 0, entry: {
          sourceUrl: 'https://b', sourceLabel: 'B', date: '2025-02-01', description: 'new',
        }}],
      }, principal);
      expect((out.data as any).entries[0].source).toEqual({ url: 'https://b', label: 'B' });
    });
  });

  // ── chronology_add_column ──────────────────────────────────────────────

  describe('chronology_add_column', () => {
    it('appends a column at end when index omitted', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, { ops: [{
        op: 'chronology_add_column',
        column: { key: 'amount', label: 'Amount (USD)', width: 12, kind: 'text' },
      }]}, principal);
      const cols = (out.data as any).columns;
      expect(cols[cols.length - 1]).toEqual({ key: 'amount', label: 'Amount (USD)', width: 12, kind: 'text' });
    });

    it('inserts at the given index', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, { ops: [{
        op: 'chronology_add_column',
        column: { key: 'amount', label: 'Amount', width: 10, kind: 'text' },
        index: 1,
      }]}, principal);
      expect((out.data as any).columns[1].key).toBe('amount');
    });

    it('rejects duplicate keys', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, { ops: [{
        op: 'chronology_add_column',
        column: { key: 'date', label: 'Date2', width: 10, kind: 'text' },
      }]}, principal)).rejects.toThrow(/duplicate column key/i);
    });

    it('rejects reserved keys', async () => {
      const prod = await seedProd();
      for (const k of ['highlight', 'sourceTraceId', 'sourceEdgeId', 'source']) {
        await expect(service.update(prod.id, { ops: [{
          op: 'chronology_add_column',
          column: { key: k, label: 'X', width: 10, kind: 'text' },
        }]}, principal)).rejects.toThrow(/reserved column key/i);
      }
    });

    it('rejects kind="link" (custom columns are text-only)', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, { ops: [{
        op: 'chronology_add_column',
        column: { key: 'extra', label: 'Extra', width: 10, kind: 'link' },
      }]}, principal)).rejects.toThrow(/kind must be "text"/);
    });

    it('rejects width outside 5–80', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, { ops: [{
        op: 'chronology_add_column',
        column: { key: 'x', label: 'X', width: 1, kind: 'text' },
      }]}, principal)).rejects.toThrow(/between 5 and 80/);
    });

    it('rejects index past end', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, { ops: [{
        op: 'chronology_add_column',
        column: { key: 'x', label: 'X', width: 10, kind: 'text' },
        index: 99,
      }]}, principal)).rejects.toThrow(/out of bounds/i);
    });
  });

  // ── chronology_remove_column ───────────────────────────────────────────

  describe('chronology_remove_column', () => {
    it('removes the matching column by key', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_remove_column', key: 'details' }],
      }, principal);
      expect((out.data as any).columns.find((c: any) => c.key === 'details')).toBeUndefined();
    });

    it('rejects unknown key', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_remove_column', key: 'nope' }],
      }, principal)).rejects.toThrow(/unknown column key/i);
    });

    it('rejects removing the last remaining column', async () => {
      const prod = await seedProd({
        columns: [{ key: 'only', label: 'Only', width: 80, kind: 'text' }],
      });
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_remove_column', key: 'only' }],
      }, principal)).rejects.toThrow(/at least one column/i);
    });

    it('leaves orphaned entry values intact', async () => {
      const prod = await seedProd({
        entries: [{ date: '2025-01-01', description: 'x', details: 'orphan me' }],
      });
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_remove_column', key: 'details' }],
      }, principal);
      expect((out.data as any).entries[0].details).toBe('orphan me');
    });
  });

  // ── chronology_update_column ───────────────────────────────────────────

  describe('chronology_update_column', () => {
    it('renames the label', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_update_column', key: 'description', patch: { label: 'Event' } }],
      }, principal);
      expect((out.data as any).columns.find((c: any) => c.key === 'description').label).toBe('Event');
    });

    it('rejects changing key', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_update_column', key: 'description', patch: { key: 'desc' } }],
      }, principal)).rejects.toThrow(/cannot change column key/i);
    });

    it('rejects changing kind', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_update_column', key: 'description', patch: { kind: 'link' } }],
      }, principal)).rejects.toThrow(/cannot change column kind/i);
    });

    it('rejects unknown key', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_update_column', key: 'nope', patch: { label: 'X' } }],
      }, principal)).rejects.toThrow(/unknown column key/i);
    });
  });

  // ── chronology_reorder_columns ─────────────────────────────────────────

  describe('chronology_reorder_columns', () => {
    it('reorders the columns array by the given keys', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [{ op: 'chronology_reorder_columns', keys: ['date', 'source', 'description', 'details'] }],
      }, principal);
      expect((out.data as any).columns.map((c: any) => c.key))
        .toEqual(['date', 'source', 'description', 'details']);
    });

    it('rejects when keys do not match existing column set', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_reorder_columns', keys: ['date', 'source'] }],
      }, principal)).rejects.toThrow(/must include exactly the existing column keys/i);
    });

    it('rejects empty keys array', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [{ op: 'chronology_reorder_columns', keys: [] }],
      }, principal)).rejects.toThrow(/non-empty/i);
    });
  });

  // ── column op sequencing in one call ──────────────────────────────────

  describe('column op sequencing in one call', () => {
    it('chains remove + set_column_widths: the second op fails if it references the removed key', async () => {
      const prod = await seedProd();
      await expect(service.update(prod.id, {
        ops: [
          { op: 'chronology_remove_column', key: 'details' },
          { op: 'chronology_set_column_widths', widths: { details: 30 } },
        ],
      }, principal)).rejects.toThrow(/unknown column key "details"/);
    });

    it('chains add + append: appended entries use the new column key', async () => {
      const prod = await seedProd();
      const out = await service.update(prod.id, {
        ops: [
          { op: 'chronology_add_column', column: { key: 'amount', label: 'Amount', width: 10, kind: 'text' } },
          { op: 'chronology_append', entries: [{ date: '2025-01-01', description: 'd', amount: '$1' }] },
        ],
      }, principal);
      expect((out.data as any).entries[0].amount).toBe('$1');
    });
  });

  // ── declaration ops ────────────────────────────────────────────────────

  describe('declaration ops', () => {
    // Seed a declaration production and wire the mock repo so `findOneBy`
    // returns it and `save` round-trips it.
    async function seedDecl(input: Partial<DeclarationData> = {}): Promise<ProductionEntity> {
      const prod = makeProduction({
        type: ProductionType.DECLARATION,
        data: seedDeclarationData(input) as unknown as Record<string, unknown>,
      });
      mockProductionRepo.findOneBy.mockResolvedValue(prod);
      mockProductionRepo.save.mockImplementation((p: ProductionEntity) => Promise.resolve({ ...p }));
      return prod;
    }

    const decl = (out: ProductionEntity): DeclarationData => out.data as unknown as DeclarationData;

    // ── create() — declaration seeding ──────────────────────────────────
    describe('create() — declaration seeding', () => {
      beforeEach(() => {
        mockProductionRepo.create.mockImplementation((obj: any) => ({ ...obj }));
        mockProductionRepo.save.mockImplementation((p: any) => Promise.resolve({ ...p }));
      });

      it('seeds a skeleton (6 sections, schemaVersion 1, formatId canonicalized from variant)', async () => {
        // Back-compat: an incoming deprecated `variant` is accepted and written
        // as the canonical `formatId`; new rows no longer carry `variant`.
        const out = await service.create('case-1', {
          name: 'Decl', type: ProductionType.DECLARATION, data: { variant: 'ny-affirmation' },
        }, principal);
        const d = decl(out);
        expect(d.schemaVersion).toBe(1);
        expect(d.formatId).toBe('ny-affirmation');
        expect(d.sections).toHaveLength(6);
        expect(d.exhibits).toEqual([]);
      });

      it('accepts a new formatId directly (federal-1746)', async () => {
        const out = await service.create('case-1', {
          name: 'Decl', type: ProductionType.DECLARATION, data: { formatId: 'federal-1746' },
        }, principal);
        expect(decl(out).formatId).toBe('federal-1746');
      });

      it('defaults unknown/absent format to ca-declaration', async () => {
        const out = await service.create('case-1', {
          name: 'Decl', type: ProductionType.DECLARATION, data: {},
        }, principal);
        expect(decl(out).formatId).toBe('ca-declaration');
      });

      it('does not touch non-declaration types', async () => {
        const out = await service.create('case-1', {
          name: 'R', type: ProductionType.REPORT, data: { content: '<p>x</p>' },
        }, principal);
        expect((out.data as any).sections).toBeUndefined();
      });

      it('preserves declarantDateOfBirth and declarantAddress from input (tx-declaration)', async () => {
        const out = await service.create('case-1', {
          name: 'Decl',
          type: ProductionType.DECLARATION,
          data: {
            formatId: 'tx-declaration',
            declarantDateOfBirth: '1980-01-01',
            declarantAddress: '123 Main St, Austin, TX',
          },
        }, principal);
        const d = decl(out);
        expect(d.declarantDateOfBirth).toBe('1980-01-01');
        expect(d.declarantAddress).toBe('123 Main St, Austin, TX');
      });
    });

    // ── declaration_add_paragraph ───────────────────────────────────────
    describe('declaration_add_paragraph', () => {
      it('appends to the named section and assigns a UUID with defaulted fields', async () => {
        const prod = await seedDecl();
        const sectionId = decl(prod).sections[0].id;
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_paragraph', sectionId, text: 'First para' }],
        }, principal);
        const paras = decl(out).sections[0].paragraphs;
        expect(paras).toHaveLength(1);
        expect(paras[0].text).toBe('First para');
        expect(paras[0].id).toMatch(/^[0-9a-f-]{36}$/);
        expect(paras[0].subItems).toEqual([]);
        expect(paras[0].exhibitIds).toEqual([]);
        expect(paras[0].footnotes).toEqual([]);
      });

      it('maps subItems and footnotes into {id, text} objects', async () => {
        const prod = await seedDecl();
        const sectionId = decl(prod).sections[0].id;
        const out = await service.update(prod.id, {
          ops: [{
            op: 'declaration_add_paragraph', sectionId, text: 'P',
            subItems: [{ text: 'sub a' }, { text: 'sub b' }],
            footnotes: [{ text: 'fn a' }],
          }],
        }, principal);
        const p = decl(out).sections[0].paragraphs[0];
        expect(p.subItems.map((s) => s.text)).toEqual(['sub a', 'sub b']);
        expect(p.subItems.every((s) => /^[0-9a-f-]{36}$/.test(s.id))).toBe(true);
        expect(p.footnotes.map((f) => f.text)).toEqual(['fn a']);
        expect(p.footnotes.every((f) => /^[0-9a-f-]{36}$/.test(f.id))).toBe(true);
      });

      it('inserts after afterParagraphId within the section', async () => {
        const prod = await seedDecl();
        const sectionId = decl(prod).sections[0].id;
        const afterFirst = await service.update(prod.id, {
          ops: [
            { op: 'declaration_add_paragraph', sectionId, text: 'one' },
            { op: 'declaration_add_paragraph', sectionId, text: 'three' },
          ],
        }, principal);
        const firstId = decl(afterFirst).sections[0].paragraphs[0].id;
        // re-seed the mock with the intermediate state
        mockProductionRepo.findOneBy.mockResolvedValue(afterFirst);
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_paragraph', sectionId, text: 'two', afterParagraphId: firstId }],
        }, principal);
        expect(decl(out).sections[0].paragraphs.map((p) => p.text)).toEqual(['one', 'two', 'three']);
      });

      it('validates exhibitIds against the registry', async () => {
        const prod = await seedDecl({
          exhibits: [{ id: 'ex-1', label: 'A', description: 'exhibit a', source: null }],
        });
        const sectionId = decl(prod).sections[0].id;
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_paragraph', sectionId, text: 'P', exhibitIds: ['ex-1'] }],
        }, principal);
        expect(decl(out).sections[0].paragraphs[0].exhibitIds).toEqual(['ex-1']);
      });

      it('rejects an exhibitId not in the registry', async () => {
        const prod = await seedDecl();
        const sectionId = decl(prod).sections[0].id;
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_add_paragraph', sectionId, text: 'P', exhibitIds: ['nope'] }],
        }, principal)).rejects.toThrow(/unknown exhibit/i);
      });

      it('rejects an unknown sectionId', async () => {
        const prod = await seedDecl();
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_add_paragraph', sectionId: 'nope', text: 'P' }],
        }, principal)).rejects.toThrow(/unknown section/i);
      });
    });

    // ── declaration_update_paragraph ────────────────────────────────────
    describe('declaration_update_paragraph', () => {
      async function seedWithPara(): Promise<{ prod: ProductionEntity; paraId: string }> {
        const prod = await seedDecl();
        const sectionId = decl(prod).sections[0].id;
        const withPara = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_paragraph', sectionId, text: 'orig' }],
        }, principal);
        mockProductionRepo.findOneBy.mockResolvedValue(withPara);
        return { prod, paraId: decl(withPara).sections[0].paragraphs[0].id };
      }

      it('merges only provided fields', async () => {
        const { prod, paraId } = await seedWithPara();
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_update_paragraph', paragraphId: paraId, text: 'updated' }],
        }, principal);
        const p = decl(out).sections[0].paragraphs[0];
        expect(p.text).toBe('updated');
        expect(p.subItems).toEqual([]);
      });

      it('reuses provided subItem ids and generates ids for new ones', async () => {
        const { prod, paraId } = await seedWithPara();
        const out = await service.update(prod.id, {
          ops: [{
            op: 'declaration_update_paragraph', paragraphId: paraId,
            subItems: [{ id: 'keep-me', text: 'a' }, { text: 'b' }],
          }],
        }, principal);
        const subs = decl(out).sections[0].paragraphs[0].subItems;
        expect(subs[0].id).toBe('keep-me');
        expect(subs[1].id).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('validates provided exhibitIds', async () => {
        const { prod, paraId } = await seedWithPara();
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_update_paragraph', paragraphId: paraId, exhibitIds: ['nope'] }],
        }, principal)).rejects.toThrow(/unknown exhibit/i);
      });

      it('rejects an unknown paragraphId', async () => {
        const prod = await seedDecl();
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_update_paragraph', paragraphId: 'nope', text: 'x' }],
        }, principal)).rejects.toThrow(/unknown paragraph/i);
      });
    });

    // ── declaration_remove_paragraph ────────────────────────────────────
    describe('declaration_remove_paragraph', () => {
      it('removes the paragraph', async () => {
        const prod = await seedDecl();
        const sectionId = decl(prod).sections[0].id;
        const withPara = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_paragraph', sectionId, text: 'gone' }],
        }, principal);
        const paraId = decl(withPara).sections[0].paragraphs[0].id;
        mockProductionRepo.findOneBy.mockResolvedValue(withPara);
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_remove_paragraph', paragraphId: paraId }],
        }, principal);
        expect(decl(out).sections[0].paragraphs).toHaveLength(0);
      });

      it('rejects an unknown paragraphId', async () => {
        const prod = await seedDecl();
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_remove_paragraph', paragraphId: 'nope' }],
        }, principal)).rejects.toThrow(/unknown paragraph/i);
      });
    });

    // ── declaration_add_section ─────────────────────────────────────────
    describe('declaration_add_section', () => {
      it('appends a section when afterSectionId omitted', async () => {
        const prod = await seedDecl();
        const before = decl(prod).sections.length;
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_section', kind: 'custom', heading: 'EXTRA' }],
        }, principal);
        const sections = decl(out).sections;
        expect(sections).toHaveLength(before + 1);
        expect(sections[sections.length - 1]).toMatchObject({ kind: 'custom', heading: 'EXTRA', paragraphs: [] });
        expect(sections[sections.length - 1].id).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('inserts after afterSectionId', async () => {
        const prod = await seedDecl();
        const firstId = decl(prod).sections[0].id;
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_section', kind: 'custom', heading: 'INSERTED', afterSectionId: firstId }],
        }, principal);
        expect(decl(out).sections[1].heading).toBe('INSERTED');
      });

      it('rejects an invalid kind', async () => {
        const prod = await seedDecl();
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_add_section', kind: 'bogus', heading: 'X' }],
        }, principal)).rejects.toThrow(/kind/i);
      });
    });

    // ── declaration_add_exhibit ─────────────────────────────────────────
    describe('declaration_add_exhibit', () => {
      it('auto-assigns the next label when omitted', async () => {
        const prod = await seedDecl();
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_add_exhibit', description: 'first' }],
        }, principal);
        const ex = decl(out).exhibits[0];
        expect(ex.label).toBe('A');
        expect(ex.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(ex.source).toBeNull();
      });

      it('uses the provided label and stores the source', async () => {
        const prod = await seedDecl();
        const out = await service.update(prod.id, {
          ops: [{
            op: 'declaration_add_exhibit', label: 'X', description: 'd',
            source: { kind: 'url', url: 'https://x' },
          }],
        }, principal);
        const ex = decl(out).exhibits[0];
        expect(ex.label).toBe('X');
        expect(ex.source).toEqual({ kind: 'url', url: 'https://x' });
      });

      it('rejects a duplicate explicit label', async () => {
        const prod = await seedDecl({
          exhibits: [{ id: 'ex-1', label: 'A', description: 'a', source: null }],
        });
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_add_exhibit', label: 'A', description: 'dup' }],
        }, principal)).rejects.toThrow(/label.*(in use|used|exists|duplicate)/i);
      });
    });

    // ── declaration_update_exhibit ──────────────────────────────────────
    describe('declaration_update_exhibit', () => {
      it('merges the provided fields', async () => {
        const prod = await seedDecl({
          exhibits: [{ id: 'ex-1', label: 'A', description: 'old', source: null }],
        });
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_update_exhibit', exhibitId: 'ex-1', description: 'new' }],
        }, principal);
        const ex = decl(out).exhibits[0];
        expect(ex.description).toBe('new');
        expect(ex.label).toBe('A');
      });

      it('rejects an unknown exhibitId', async () => {
        const prod = await seedDecl();
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_update_exhibit', exhibitId: 'nope', description: 'x' }],
        }, principal)).rejects.toThrow(/unknown exhibit/i);
      });

      it('rejects relabeling to a label used by another exhibit', async () => {
        const prod = await seedDecl({
          exhibits: [
            { id: 'ex-1', label: 'A', description: 'a', source: null },
            { id: 'ex-2', label: 'B', description: 'b', source: null },
          ],
        });
        await expect(service.update(prod.id, {
          ops: [{ op: 'declaration_update_exhibit', exhibitId: 'ex-2', label: 'A' }],
        }, principal)).rejects.toThrow(/label.*(in use|used|exists|duplicate)/i);
      });
    });

    // ── declaration_set_caption / declaration_set_execution ─────────────
    describe('declaration_set_caption / declaration_set_execution', () => {
      it('shallow-merges the caption partial', async () => {
        const prod = await seedDecl();
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_set_caption', caption: { court: 'SUPERIOR COURT' } }],
        }, principal);
        const c = decl(out).caption;
        expect(c.court).toBe('SUPERIOR COURT');
        expect(c.county).toBe(''); // untouched
      });

      it('shallow-merges the execution partial', async () => {
        const prod = await seedDecl();
        const out = await service.update(prod.id, {
          ops: [{ op: 'declaration_set_execution', execution: { place: 'Los Angeles, CA' } }],
        }, principal);
        const e = decl(out).execution;
        expect(e.place).toBe('Los Angeles, CA');
        expect(e.date).toBe(''); // untouched
      });
    });

    // ── type-mismatch guard ─────────────────────────────────────────────
    it('rejects a declaration op on a non-declaration production', async () => {
      mockProductionRepo.findOneBy.mockResolvedValue(makeProduction()); // REPORT
      await expect(service.update('prod-1', {
        ops: [{ op: 'declaration_set_caption', caption: { court: 'X' } }],
      }, principal)).rejects.toThrow(/not "declaration"/);
    });
  });

  // ── redline ops ────────────────────────────────────────────────────────

  describe('redline ops', () => {
    // baseText: two paragraphs joined by '\n\n'.
    //   "the parties agree" appears twice → ambiguous.
    //   "the quarterly financial report" appears once → unique.
    //   "quarterly financial report was filed" overlaps the unique anchor.
    //   "more terms. Second para" spans the paragraph break → crosses_paragraphs.
    //   "terms" normalizes to < 8 chars → too_short.
    const BASE_TEXT =
      'First para: the parties agree to terms here, and the parties agree to more terms.\n\nSecond para: the quarterly financial report was filed on time.';
    const UNIQUE = 'the quarterly financial report';
    const OVERLAP = 'quarterly financial report was filed';

    async function seedRedline(overrides: Partial<RedlineData> = {}): Promise<ProductionEntity> {
      const data = seedRedlineData(
        {
          fileId: 'file-1',
          fileName: 'contract.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          kind: 'docx',
          extractedAt: '2026-01-01T00:00:00.000Z',
        },
        BASE_TEXT,
      );
      const prod = makeProduction({
        type: ProductionType.REDLINE,
        data: { ...data, ...overrides } as unknown as Record<string, unknown>,
      });
      mockProductionRepo.findOneBy.mockResolvedValue(prod);
      mockProductionRepo.save.mockImplementation((p: ProductionEntity) => Promise.resolve({ ...p }));
      return prod;
    }

    const rl = (out: ProductionEntity): RedlineData => out.data as unknown as RedlineData;

    // ── redline_add_edit ──────────────────────────────────────────────────
    describe('redline_add_edit', () => {
      it('resolves the anchor and appends a proposed agent edit with a server UUID', async () => {
        const prod = await seedRedline();
        const out = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'the annual report', basis: 'stale figure' }],
        }, principal);
        const edits = rl(out).edits;
        expect(edits).toHaveLength(1);
        const e = edits[0];
        expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(e.kind).toBe('replace');
        expect(e.status).toBe('proposed');
        expect(e.origin).toBe('agent');
        expect(e.newText).toBe('the annual report');
        expect(e.basis).toBe('stale figure');
        // anchor.text is the RAW matched span, re-derived from baseText.slice
        expect(e.anchor.text).toBe(UNIQUE);
        expect(BASE_TEXT.slice(e.anchor.start, e.anchor.end)).toBe(UNIQUE);
      });

      it('honors origin: "user" and defaults anything else to "agent"', async () => {
        const prod = await seedRedline();
        const asUser = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b', origin: 'user' }],
        }, principal);
        expect(rl(asUser).edits[0].origin).toBe('user');

        const prod2 = await seedRedline();
        const asOther = await service.update(prod2.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b', origin: 'robot' }],
        }, principal);
        expect(rl(asOther).edits[0].origin).toBe('agent');
      });

      it('stores an optional comment when provided', async () => {
        const prod = await seedRedline();
        const out = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b', comment: 'see para 4' }],
        }, principal);
        expect(rl(out).edits[0].comment).toBe('see para 4');
      });

      it('stores "" for a delete edit and omits newText requirement', async () => {
        const prod = await seedRedline();
        const out = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'delete', anchorText: UNIQUE, basis: 'b' }],
        }, principal);
        const e = rl(out).edits[0];
        expect(e.kind).toBe('delete');
        expect(e.newText).toBe('');
      });

      it('rejects an ambiguous anchor with the count and disambiguation guidance', async () => {
        const prod = await seedRedline();
        const err = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: 'the parties agree', newText: 'x', basis: 'b' }],
        }, principal).catch((e) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.message).toContain('anchor_ambiguous');
        expect(err.message).toContain('2');
        expect(err.message).toContain('quote a longer span');
      });

      it('rejects a not-found anchor naming anchor_not_found', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: 'this phrase does not exist anywhere', newText: 'x', basis: 'b' }],
        }, principal)).rejects.toThrow(/anchor_not_found/);
      });

      it('rejects a too-short anchor naming anchor_too_short', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: 'terms', newText: 'x', basis: 'b' }],
        }, principal)).rejects.toThrow(/anchor_too_short/);
      });

      it('rejects an anchor that crosses paragraphs naming anchor_crosses_paragraphs', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: 'more terms. Second para', newText: 'x', basis: 'b' }],
        }, principal)).rejects.toThrow(/anchor_crosses_paragraphs/);
      });

      it('rejects a delete with a non-empty newText', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'delete', anchorText: UNIQUE, newText: 'nope', basis: 'b' }],
        }, principal)).rejects.toThrow(BadRequestException);
      });

      it('rejects an insert_after without newText', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'insert_after', anchorText: UNIQUE, basis: 'b' }],
        }, principal)).rejects.toThrow(/newText/);
      });

      it('rejects a replace without newText', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, basis: 'b' }],
        }, principal)).rejects.toThrow(/newText/);
      });

      it('rejects a missing or empty basis', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x' }],
        }, principal)).rejects.toThrow(/basis/);
        const prod2 = await seedRedline();
        await expect(service.update(prod2.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: '  ' }],
        }, principal)).rejects.toThrow(/basis/);
      });

      it('rejects an invalid kind', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'bogus', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal)).rejects.toThrow(/kind/);
      });

      it('re-derives anchor.text as the raw document span, not the caller\'s straight-quote input', async () => {
        const curlyText =
          'The report “Q3 figures” was filed on time.\n\nSecond para: the quarterly financial report was filed on time.';
        const data = seedRedlineData(
          {
            fileId: 'file-1',
            fileName: 'contract.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            kind: 'docx',
            extractedAt: '2026-01-01T00:00:00.000Z',
          },
          curlyText,
        );
        const prod = makeProduction({
          type: ProductionType.REDLINE,
          data: data as unknown as Record<string, unknown>,
        });
        mockProductionRepo.findOneBy.mockResolvedValue(prod);
        mockProductionRepo.save.mockImplementation((p: ProductionEntity) => Promise.resolve({ ...p }));

        const out = await service.update(prod.id, {
          ops: [{
            op: 'redline_add_edit',
            kind: 'replace',
            anchorText: '"Q3 figures" was filed',
            newText: 'x',
            basis: 'b',
          }],
        }, principal);
        const e = rl(out).edits[0];
        expect(curlyText.slice(e.anchor.start, e.anchor.end)).toBe(e.anchor.text);
        expect(e.anchor.text).toContain('“');
        expect(e.anchor.text).toContain('”');
      });
    });

    // ── redline_add_edit overlap gate ─────────────────────────────────────
    describe('redline_add_edit overlap gate', () => {
      it('rejects a replace overlapping a proposed edit', async () => {
        const prod = await seedRedline();
        const withA = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal);
        mockProductionRepo.findOneBy.mockResolvedValue(withA);
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: OVERLAP, newText: 'y', basis: 'b' }],
        }, principal)).rejects.toThrow(/overlap/i);
      });

      it('rejects a delete overlapping an accepted edit', async () => {
        const prod = await seedRedline();
        const withA = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal);
        const editA = rl(withA).edits[0];
        mockProductionRepo.findOneBy.mockResolvedValue(withA);
        const accepted = await service.update(prod.id, {
          ops: [{ op: 'redline_update_edit', editId: editA.id, status: 'accepted' }],
        }, principal);
        mockProductionRepo.findOneBy.mockResolvedValue(accepted);
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'delete', anchorText: OVERLAP, basis: 'b' }],
        }, principal)).rejects.toThrow(/overlap/i);
      });

      it('allows a replace overlapping a rejected edit', async () => {
        const prod = await seedRedline();
        const withA = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal);
        const editA = rl(withA).edits[0];
        mockProductionRepo.findOneBy.mockResolvedValue(withA);
        const rejected = await service.update(prod.id, {
          ops: [{ op: 'redline_update_edit', editId: editA.id, status: 'rejected' }],
        }, principal);
        mockProductionRepo.findOneBy.mockResolvedValue(rejected);
        const withB = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: OVERLAP, newText: 'y', basis: 'b' }],
        }, principal);
        expect(rl(withB).edits).toHaveLength(2);
      });

      it('allows an insert_after overlapping a proposed edit (insert_after never conflicts as adder)', async () => {
        const prod = await seedRedline();
        const withA = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal);
        mockProductionRepo.findOneBy.mockResolvedValue(withA);
        const withB = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'insert_after', anchorText: OVERLAP, newText: ' (added)', basis: 'b' }],
        }, principal);
        expect(rl(withB).edits).toHaveLength(2);
      });

      it('allows a replace overlapping an existing insert_after (insert_after is not an obstacle)', async () => {
        const prod = await seedRedline();
        const withA = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'insert_after', anchorText: UNIQUE, newText: ' (added)', basis: 'b' }],
        }, principal);
        mockProductionRepo.findOneBy.mockResolvedValue(withA);
        const withB = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: OVERLAP, newText: 'y', basis: 'b' }],
        }, principal);
        expect(rl(withB).edits).toHaveLength(2);
      });
    });

    // ── redline_update_edit ───────────────────────────────────────────────
    describe('redline_update_edit', () => {
      async function seedWithEdit(): Promise<{ prodId: string; editId: string }> {
        const prod = await seedRedline();
        const withA = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal);
        mockProductionRepo.findOneBy.mockResolvedValue(withA);
        return { prodId: prod.id, editId: rl(withA).edits[0].id };
      }

      it('walks status proposed → accepted → rejected → proposed', async () => {
        const { prodId, editId } = await seedWithEdit();
        for (const status of ['accepted', 'rejected', 'proposed'] as const) {
          const out = await service.update(prodId, {
            ops: [{ op: 'redline_update_edit', editId, status }],
          }, principal);
          expect(rl(out).edits[0].status).toBe(status);
          mockProductionRepo.findOneBy.mockResolvedValue(out);
        }
      });

      it('patches newText, basis, and comment', async () => {
        const { prodId, editId } = await seedWithEdit();
        const out = await service.update(prodId, {
          ops: [{ op: 'redline_update_edit', editId, newText: 'revised', basis: 'better reason', comment: 'note' }],
        }, principal);
        const e = rl(out).edits[0];
        expect(e.newText).toBe('revised');
        expect(e.basis).toBe('better reason');
        expect(e.comment).toBe('note');
        // anchor & kind unchanged
        expect(e.anchor.text).toBe(UNIQUE);
        expect(e.kind).toBe('replace');
      });

      it('rejects an invalid status', async () => {
        const { prodId, editId } = await seedWithEdit();
        await expect(service.update(prodId, {
          ops: [{ op: 'redline_update_edit', editId, status: 'maybe' }],
        }, principal)).rejects.toThrow(/status/);
      });

      it('rejects an unknown editId', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_update_edit', editId: 'nope', status: 'accepted' }],
        }, principal)).rejects.toThrow(/unknown edit/i);
      });

      it('rejects an attempt to change the anchor', async () => {
        const { prodId, editId } = await seedWithEdit();
        await expect(service.update(prodId, {
          ops: [{ op: 'redline_update_edit', editId, anchorText: 'something else here' }],
        }, principal)).rejects.toThrow(BadRequestException);
      });

      it('rejects an attempt to change the kind', async () => {
        const { prodId, editId } = await seedWithEdit();
        await expect(service.update(prodId, {
          ops: [{ op: 'redline_update_edit', editId, kind: 'delete' }],
        }, principal)).rejects.toThrow(BadRequestException);
      });

      it('rejects an empty/whitespace basis on update', async () => {
        const { prodId, editId } = await seedWithEdit();
        await expect(service.update(prodId, {
          ops: [{ op: 'redline_update_edit', editId, basis: '   ' }],
        }, principal)).rejects.toThrow(/basis/);
      });

      it('rejects an attempt to set a literal `anchor` key', async () => {
        const { prodId, editId } = await seedWithEdit();
        await expect(service.update(prodId, {
          ops: [{ op: 'redline_update_edit', editId, anchor: { text: 'x', start: 0, end: 1 } }],
        }, principal)).rejects.toThrow(/immutable/);
      });
    });

    // ── redline_remove_edit ───────────────────────────────────────────────
    describe('redline_remove_edit', () => {
      it('removes the edit by id', async () => {
        const prod = await seedRedline();
        const withA = await service.update(prod.id, {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal);
        const editId = rl(withA).edits[0].id;
        mockProductionRepo.findOneBy.mockResolvedValue(withA);
        const out = await service.update(prod.id, {
          ops: [{ op: 'redline_remove_edit', editId }],
        }, principal);
        expect(rl(out).edits).toHaveLength(0);
      });

      it('rejects an unknown editId', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_remove_edit', editId: 'nope' }],
        }, principal)).rejects.toThrow(/unknown edit/i);
      });
    });

    // ── redline comment ops ───────────────────────────────────────────────
    describe('redline comment ops', () => {
      it('appends a comment with a server UUID', async () => {
        const prod = await seedRedline();
        const out = await service.update(prod.id, {
          ops: [{ op: 'redline_add_comment', title: 'Cover note', text: 'Overall this is fine.' }],
        }, principal);
        const comments = rl(out).comments;
        expect(comments).toHaveLength(1);
        expect(comments[0].id).toMatch(/^[0-9a-f-]{36}$/);
        expect(comments[0].title).toBe('Cover note');
        expect(comments[0].text).toBe('Overall this is fine.');
      });

      it('patches title and text on an existing comment', async () => {
        const prod = await seedRedline();
        const withC = await service.update(prod.id, {
          ops: [{ op: 'redline_add_comment', title: 't', text: 'x' }],
        }, principal);
        const commentId = rl(withC).comments[0].id;
        mockProductionRepo.findOneBy.mockResolvedValue(withC);
        const out = await service.update(prod.id, {
          ops: [{ op: 'redline_update_comment', commentId, title: 'T2', text: 'y' }],
        }, principal);
        expect(rl(out).comments[0]).toMatchObject({ id: commentId, title: 'T2', text: 'y' });
      });

      it('rejects update on an unknown commentId', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_update_comment', commentId: 'nope', title: 'X' }],
        }, principal)).rejects.toThrow(/unknown comment/i);
      });

      it('removes a comment by id', async () => {
        const prod = await seedRedline();
        const withC = await service.update(prod.id, {
          ops: [{ op: 'redline_add_comment', title: 't', text: 'x' }],
        }, principal);
        const commentId = rl(withC).comments[0].id;
        mockProductionRepo.findOneBy.mockResolvedValue(withC);
        const out = await service.update(prod.id, {
          ops: [{ op: 'redline_remove_comment', commentId }],
        }, principal);
        expect(rl(out).comments).toHaveLength(0);
      });

      it('rejects remove on an unknown commentId', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          ops: [{ op: 'redline_remove_comment', commentId: 'nope' }],
        }, principal)).rejects.toThrow(/unknown comment/i);
      });
    });

    // ── prefix gate ───────────────────────────────────────────────────────
    describe('prefix gate', () => {
      it('rejects a redline op on a chronology production', async () => {
        mockProductionRepo.findOneBy.mockResolvedValue(
          makeProduction({ type: ProductionType.CHRONOLOGY, data: { entries: [] } }),
        );
        mockProductionRepo.save.mockImplementation((p: ProductionEntity) => Promise.resolve({ ...p }));
        await expect(service.update('prod-1', {
          ops: [{ op: 'redline_add_edit', kind: 'replace', anchorText: UNIQUE, newText: 'x', basis: 'b' }],
        }, principal)).rejects.toThrow(/not "redline"/);
      });

      it('rejects a redline op on a declaration production', async () => {
        mockProductionRepo.findOneBy.mockResolvedValue(
          makeProduction({ type: ProductionType.DECLARATION, data: seedDeclarationData({}) as unknown as Record<string, unknown> }),
        );
        mockProductionRepo.save.mockImplementation((p: ProductionEntity) => Promise.resolve({ ...p }));
        await expect(service.update('prod-1', {
          ops: [{ op: 'redline_add_comment', title: 't', text: 'x' }],
        }, principal)).rejects.toThrow(/not "redline"/);
      });
    });

    // ── update() immutability guards ──────────────────────────────────────
    describe('update() immutability guards', () => {
      it('rejects a full data replacement on a redline production', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          data: { baseText: 'tampered' },
        }, principal)).rejects.toThrow(/redline productions are ops-only/);
      });

      it('rejects changing a redline production to another type', async () => {
        const prod = await seedRedline();
        await expect(service.update(prod.id, {
          type: ProductionType.REPORT,
        }, principal)).rejects.toThrow(/redline/);
      });

      it('rejects changing a non-redline production to redline', async () => {
        mockProductionRepo.findOneBy.mockResolvedValue(makeProduction()); // REPORT
        await expect(service.update('prod-1', {
          type: ProductionType.REDLINE,
        }, principal)).rejects.toThrow(/redline/);
      });
    });
  });
});
