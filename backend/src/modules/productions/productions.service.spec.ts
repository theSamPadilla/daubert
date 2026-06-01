import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ProductionsService } from './productions.service';
import {
  ProductionEntity,
  ProductionType,
} from '../../database/entities/production.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { AccessPrincipal } from '../auth/access-principal';
import { seedChronologyData } from './chronology-schema';

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

const USER_PRINCIPAL: AccessPrincipal = { kind: 'user', userId: 'user-1' };
const SCRIPT_PRINCIPAL: AccessPrincipal = { kind: 'script', caseId: 'case-1' };
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
});
