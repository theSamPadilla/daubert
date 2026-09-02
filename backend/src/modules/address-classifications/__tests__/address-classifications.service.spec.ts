import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  AddressClassificationsService,
  classificationKey,
} from '../address-classifications.service';
import { AddressClassificationEntity } from '../../../database/entities/address-classification.entity';
import { ProviderRegistry } from '../../blockchain/provider-registry';

describe('AddressClassificationsService', () => {
  let service: AddressClassificationsService;

  const mockQb = {
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };

  const mockRepo = {
    create: jest.fn((entity: Partial<AddressClassificationEntity>) => entity),
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  const mockProviderRegistry = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddressClassificationsService,
        { provide: getRepositoryToken(AddressClassificationEntity), useValue: mockRepo },
        { provide: ProviderRegistry, useValue: mockProviderRegistry },
      ],
    }).compile();

    service = module.get<AddressClassificationsService>(AddressClassificationsService);

    jest.clearAllMocks();
    mockRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockRepo.create.mockImplementation((entity) => entity);
    mockQb.where.mockReturnThis();
    mockQb.insert.mockReturnThis();
    mockQb.into.mockReturnThis();
    mockQb.values.mockReturnThis();
    mockQb.onConflict.mockReturnThis();
    mockQb.execute.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // lookupMany
  // ---------------------------------------------------------------------------
  describe('lookupMany', () => {
    it('returns an empty map for empty input without querying', async () => {
      const result = await service.lookupMany([]);
      expect(result.size).toBe(0);
      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('issues one query for N pairs and keys results canonically', async () => {
      const rowA = { chain: 'ethereum', address: '0xaaa', addressType: 'wallet' } as never;
      const rowB = { chain: 'tron', address: 'TAbc123', addressType: 'contract' } as never;
      mockQb.getMany.mockResolvedValue([rowA, rowB]);

      const result = await service.lookupMany([
        { chain: 'ethereum', address: '0xaaa' },
        { chain: 'tron', address: 'TAbc123' },
        { chain: 'ethereum', address: '0xzzz' },
      ]);

      expect(mockRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQb.getMany).toHaveBeenCalledTimes(1);
      expect(result.get(classificationKey('ethereum', '0xaaa'))).toBe(rowA);
      expect(result.get(classificationKey('tron', 'TAbc123'))).toBe(rowB);
      expect(result.get(classificationKey('ethereum', '0xzzz'))).toBeUndefined();
    });

    it('matches a lowercased stored row against mixed-case EVM input', async () => {
      const row = { chain: 'ethereum', address: '0xabc123', addressType: 'contract' } as never;
      mockQb.getMany.mockResolvedValue([row]);

      const result = await service.lookupMany([{ chain: 'ethereum', address: '0xABC123' }]);

      expect(result.get(classificationKey('ethereum', '0xABC123'))).toBe(row);
    });
  });

  // ---------------------------------------------------------------------------
  // classifyMissing
  // ---------------------------------------------------------------------------
  describe('classifyMissing', () => {
    it('drops non-EVM pairs without probing them', async () => {
      mockQb.getMany.mockResolvedValue([]); // nothing already landed
      const classifyAddress = jest.fn().mockResolvedValue({
        classification: { addressType: 'wallet' },
        determined: true,
      });
      mockProviderRegistry.get.mockReturnValue({ classifyAddress });

      const { remaining } = await service.classifyMissing([
        { chain: 'ethereum', address: '0xaaa' },
        { chain: 'tron', address: 'TAbc123' },
        { chain: 'bitcoin', address: 'bc1qxyz' },
      ]);

      expect(mockProviderRegistry.get).toHaveBeenCalledTimes(1);
      expect(mockProviderRegistry.get).toHaveBeenCalledWith('ethereum');
      expect(remaining).toBe(0);
    });

    it('persists only determined: true; an undetermined probe writes nothing', async () => {
      mockQb.getMany.mockResolvedValue([]);
      const determinedProvider = {
        classifyAddress: jest
          .fn()
          .mockResolvedValue({ classification: { addressType: 'contract' }, determined: true }),
      };
      const undeterminedProvider = {
        classifyAddress: jest
          .fn()
          .mockResolvedValue({ classification: { addressType: 'wallet' }, determined: false }),
      };
      mockProviderRegistry.get.mockImplementation((chain: string) =>
        chain === 'ethereum' ? determinedProvider : undeterminedProvider,
      );

      const { classified } = await service.classifyMissing([
        { chain: 'ethereum', address: '0xaaa' },
        { chain: 'polygon', address: '0xbbb' },
      ]);

      expect(classified).toHaveLength(1);
      expect(classified[0].chain).toBe('ethereum');
      expect(mockQb.execute).toHaveBeenCalledTimes(1);
    });

    it('does not let a throwing probe prevent classifying the others', async () => {
      mockQb.getMany.mockResolvedValue([]);
      mockProviderRegistry.get.mockImplementation((chain: string) => ({
        classifyAddress: jest.fn().mockImplementation(async () => {
          if (chain === 'ethereum') throw new Error('rpc unreachable');
          return { classification: { addressType: 'wallet' }, determined: true };
        }),
      }));

      const { classified } = await service.classifyMissing([
        { chain: 'ethereum', address: '0xaaa' },
        { chain: 'polygon', address: '0xbbb' },
      ]);

      expect(classified).toHaveLength(1);
      expect(classified[0].chain).toBe('polygon');
    });

    it('honours the cap and reports the truncated count as remaining', async () => {
      mockQb.getMany.mockResolvedValue([]);
      const classifyAddress = jest
        .fn()
        .mockResolvedValue({ classification: { addressType: 'wallet' }, determined: true });
      mockProviderRegistry.get.mockReturnValue({ classifyAddress });

      const { classified, remaining } = await service.classifyMissing(
        [
          { chain: 'ethereum', address: '0xaaa' },
          { chain: 'ethereum', address: '0xbbb' },
          { chain: 'ethereum', address: '0xccc' },
        ],
        2,
      );

      expect(classified).toHaveLength(2);
      expect(remaining).toBe(1);
    });

    it('skips an address another instance already landed via the pre-probe re-SELECT, but still reports it as classified', async () => {
      const alreadyLanded = {
        chain: 'ethereum',
        address: '0xaaa',
        addressType: 'wallet',
      } as never;
      mockQb.getMany.mockResolvedValue([alreadyLanded]);
      const classifyAddress = jest
        .fn()
        .mockResolvedValue({ classification: { addressType: 'contract' }, determined: true });
      mockProviderRegistry.get.mockReturnValue({ classifyAddress });

      const { classified } = await service.classifyMissing([
        { chain: 'ethereum', address: '0xaaa' },
        { chain: 'ethereum', address: '0xbbb' },
      ]);

      expect(classifyAddress).toHaveBeenCalledTimes(1);
      expect(classifyAddress).toHaveBeenCalledWith('0xbbb');
      // The landed row must round-trip in `classified` too — a caller has no
      // other way to tell "already on file" from "the chain had nothing to
      // say", and dropping it would make the caller re-ask forever.
      expect(classified).toHaveLength(2);
      expect(classified.map((c) => c.address).sort()).toEqual(['0xaaa', '0xbbb']);
    });

    // Regression for the 200-address drain scenario: a batch where the first
    // slice (in request order) was landed by another instance between this
    // caller's own /lookup and this /classify call. Before the fix, the cap
    // was applied BEFORE the already-landed filter, so the landed pairs used
    // up the whole cap, nothing got probed, and `remaining` counted the
    // landed pairs as if nobody had looked at them.
    it('does not let already-landed pairs consume cap slots or inflate remaining', async () => {
      const landedRows = [
        { chain: 'ethereum', address: '0xaaa', addressType: 'wallet' },
        { chain: 'ethereum', address: '0xbbb', addressType: 'contract' },
      ] as never[];
      mockQb.getMany.mockResolvedValue(landedRows);
      const classifyAddress = jest
        .fn()
        .mockResolvedValue({ classification: { addressType: 'wallet' }, determined: true });
      mockProviderRegistry.get.mockReturnValue({ classifyAddress });

      // 2 already landed + 3 not landed, capped to 2 probes per call.
      const { classified, remaining } = await service.classifyMissing(
        [
          { chain: 'ethereum', address: '0xaaa' },
          { chain: 'ethereum', address: '0xbbb' },
          { chain: 'ethereum', address: '0xccc' },
          { chain: 'ethereum', address: '0xddd' },
          { chain: 'ethereum', address: '0xeee' },
        ],
        2,
      );

      // Both landed pairs come back in `classified` alongside the 2 newly
      // probed ones — the cap only bit into the not-landed pairs.
      expect(classified).toHaveLength(4);
      expect(classifyAddress).toHaveBeenCalledTimes(2);
      // 3 not-landed minus the 2 the cap allowed this call = 1 genuinely
      // untouched pair — not 3, and definitely not the pre-fix value that
      // would have counted the 2 landed pairs as still outstanding too.
      expect(remaining).toBe(1);
    });

    it('returns immediately for empty input without querying', async () => {
      const { classified, remaining } = await service.classifyMissing([]);
      expect(classified).toEqual([]);
      expect(remaining).toBe(0);
      expect(mockRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // The pre-migration window is covered HERE rather than at each call site: the
  // AI chat path awaits its tool call with no catch, so an unguarded throw would
  // abort the whole response stream instead of one tool.
  describe('pre-migration degradation (42P01)', () => {
    it('lookupMany returns an empty map instead of throwing', async () => {
      mockRepo.createQueryBuilder.mockImplementation(() => {
        throw { code: '42P01' };
      });
      await expect(
        service.lookupMany([{ chain: 'ethereum', address: '0x51c0d73faec63d6471e434a483e0874f6cb17203' }]),
      ).resolves.toEqual(new Map());
    });

    it('classifyMissing returns an empty result instead of throwing', async () => {
      mockRepo.createQueryBuilder.mockImplementation(() => {
        throw { driverError: { code: '42P01' } };
      });
      await expect(
        service.classifyMissing([{ chain: 'ethereum', address: '0x51c0d73faec63d6471e434a483e0874f6cb17203' }]),
      ).resolves.toEqual({ classified: [], remaining: 0 });
    });

    it('still propagates any other database error', async () => {
      mockRepo.createQueryBuilder.mockImplementation(() => {
        throw new Error('connection refused');
      });
      await expect(
        service.lookupMany([{ chain: 'ethereum', address: '0x51c0d73faec63d6471e434a483e0874f6cb17203' }]),
      ).rejects.toThrow('connection refused');
    });
  });
});
