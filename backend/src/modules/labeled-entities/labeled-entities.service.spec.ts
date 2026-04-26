import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { LabeledEntitiesService } from './labeled-entities.service';
import {
  LabeledEntityEntity,
  EntityCategory,
} from '../../database/entities/labeled-entity.entity';
import { CreateLabeledEntityDto } from './dto/create-labeled-entity.dto';
import { UpdateLabeledEntityDto } from './dto/update-labeled-entity.dto';

describe('LabeledEntitiesService', () => {
  let service: LabeledEntitiesService;

  const mockQb = {
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  const mockRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabeledEntitiesService,
        {
          provide: getRepositoryToken(LabeledEntityEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<LabeledEntitiesService>(LabeledEntitiesService);

    // Reset all mocks before each test
    jest.clearAllMocks();
    mockRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.andWhere.mockReturnThis();
    mockQb.where.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    const entities: Partial<LabeledEntityEntity>[] = [
      { id: '1', name: 'Binance', category: EntityCategory.EXCHANGE },
      { id: '2', name: 'Tornado Cash', category: EntityCategory.MIXER },
    ];

    it('should return all entities ordered by name', async () => {
      mockQb.getMany.mockResolvedValue(entities);

      const result = await service.findAll();

      expect(mockRepo.createQueryBuilder).toHaveBeenCalledWith('e');
      expect(mockQb.orderBy).toHaveBeenCalledWith('e.name', 'ASC');
      expect(mockQb.getMany).toHaveBeenCalled();
      expect(mockQb.andWhere).not.toHaveBeenCalled();
      expect(result).toEqual(entities);
    });

    it('should filter by category when provided', async () => {
      mockQb.getMany.mockResolvedValue([entities[0]]);

      const result = await service.findAll({
        category: EntityCategory.EXCHANGE,
      });

      expect(mockQb.andWhere).toHaveBeenCalledWith('e.category = :category', {
        category: EntityCategory.EXCHANGE,
      });
      expect(mockQb.orderBy).toHaveBeenCalledWith('e.name', 'ASC');
      expect(result).toEqual([entities[0]]);
    });

    it('should filter by search (ILIKE) when provided', async () => {
      mockQb.getMany.mockResolvedValue([entities[0]]);

      const result = await service.findAll({ search: 'bin' });

      expect(mockQb.andWhere).toHaveBeenCalledWith('e.name ILIKE :search', {
        search: '%bin%',
      });
      expect(mockQb.orderBy).toHaveBeenCalledWith('e.name', 'ASC');
      expect(result).toEqual([entities[0]]);
    });

    it('should apply both category and search filters together', async () => {
      mockQb.getMany.mockResolvedValue([entities[0]]);

      const result = await service.findAll({
        category: EntityCategory.EXCHANGE,
        search: 'bin',
      });

      expect(mockQb.andWhere).toHaveBeenCalledTimes(2);
      expect(mockQb.andWhere).toHaveBeenCalledWith('e.category = :category', {
        category: EntityCategory.EXCHANGE,
      });
      expect(mockQb.andWhere).toHaveBeenCalledWith('e.name ILIKE :search', {
        search: '%bin%',
      });
      expect(result).toEqual([entities[0]]);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('should return the entity when found', async () => {
      const entity: Partial<LabeledEntityEntity> = {
        id: 'uuid-1',
        name: 'Binance',
        category: EntityCategory.EXCHANGE,
      };
      mockRepo.findOneBy.mockResolvedValue(entity);

      const result = await service.findOne('uuid-1');

      expect(mockRepo.findOneBy).toHaveBeenCalledWith({ id: 'uuid-1' });
      expect(result).toEqual(entity);
    });

    it('should throw NotFoundException when entity is not found', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('bad-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockRepo.findOneBy).toHaveBeenCalledWith({ id: 'bad-id' });
    });
  });

  // ---------------------------------------------------------------------------
  // lookupByAddress
  // ---------------------------------------------------------------------------
  describe('lookupByAddress', () => {
    it('should query with JSONB where clause and return matches', async () => {
      const entities: Partial<LabeledEntityEntity>[] = [
        {
          id: 'uuid-1',
          name: 'Binance',
          wallets: ['0xabc123'],
        },
      ];
      mockQb.getMany.mockResolvedValue(entities);

      const result = await service.lookupByAddress('  0xABC123  ');

      expect(mockRepo.createQueryBuilder).toHaveBeenCalledWith('e');
      expect(mockQb.where).toHaveBeenCalledWith(
        `EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.wallets) w WHERE w = LOWER(:address))`,
        { address: '0xABC123' },
      );
      expect(mockQb.getMany).toHaveBeenCalled();
      expect(result).toEqual(entities);
    });
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should create and save a new entity', async () => {
      const dto: CreateLabeledEntityDto = {
        name: 'Coinbase',
        category: EntityCategory.EXCHANGE,
        wallets: ['0xdef456'],
      };
      const created = { id: 'uuid-new', ...dto } as LabeledEntityEntity;
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(mockRepo.create).toHaveBeenCalledWith(dto);
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(created);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should find the entity, apply updates, and save', async () => {
      const existing = {
        id: 'uuid-1',
        name: 'Binance',
        category: EntityCategory.EXCHANGE,
        wallets: ['0xabc'],
        description: null,
        metadata: null,
      } as LabeledEntityEntity;

      mockRepo.findOneBy.mockResolvedValue(existing);

      const dto: UpdateLabeledEntityDto = { name: 'Binance US' };
      const updated = { ...existing, ...dto } as LabeledEntityEntity;
      mockRepo.save.mockResolvedValue(updated);

      const result = await service.update('uuid-1', dto);

      expect(mockRepo.findOneBy).toHaveBeenCalledWith({ id: 'uuid-1' });
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Binance US' }),
      );
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when entity does not exist', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.update('bad-id', { name: 'Nope' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('should find the entity and remove it', async () => {
      const existing = {
        id: 'uuid-1',
        name: 'Old Entity',
        category: EntityCategory.OTHER,
      } as LabeledEntityEntity;

      mockRepo.findOneBy.mockResolvedValue(existing);
      mockRepo.remove.mockResolvedValue(existing);

      await service.remove('uuid-1');

      expect(mockRepo.findOneBy).toHaveBeenCalledWith({ id: 'uuid-1' });
      expect(mockRepo.remove).toHaveBeenCalledWith(existing);
    });

    it('should throw NotFoundException when entity does not exist', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      await expect(service.remove('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
