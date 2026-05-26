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

const mockProductionRepo = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
};

const mockCaseAccess = {
  assertAccess: jest.fn(),
};

const USER_PRINCIPAL: AccessPrincipal = { kind: 'user', userId: 'user-1' };
const SCRIPT_PRINCIPAL: AccessPrincipal = { kind: 'script', caseId: 'case-1' };

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

      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1');
      expect(mockProductionRepo.find).toHaveBeenCalledWith({
        where: { caseId: 'case-1' },
        order: { createdAt: 'ASC' },
      });
      expect(result).toEqual(productions);
    });

    it('accepts a script principal scoped to the same case', async () => {
      mockProductionRepo.find.mockResolvedValue([]);
      await service.findAllForCase('case-1', SCRIPT_PRINCIPAL);
      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(SCRIPT_PRINCIPAL, 'case-1');
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
      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1');
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

      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1');
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

      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(SCRIPT_PRINCIPAL, 'case-1');
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

      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1');
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
            title: 'T',
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
              { date: 'd', description: 'x', highlight: 'amber' },
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
        ).rejects.toThrow(/color.*yellow.*amber.*red.*green.*blue.*null/);
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

      expect(mockCaseAccess.assertAccess).toHaveBeenCalledWith(USER_PRINCIPAL, 'case-1');
      expect(mockProductionRepo.remove).toHaveBeenCalledWith(production);
    });

    it('throws NotFoundException for bad ID', async () => {
      mockProductionRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('bad-id', USER_PRINCIPAL)).rejects.toThrow(NotFoundException);
    });
  });
});
