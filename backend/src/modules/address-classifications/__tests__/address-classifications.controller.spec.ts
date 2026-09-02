import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AddressClassificationsController } from '../address-classifications.controller';
import { AddressClassificationsService } from '../address-classifications.service';
import { AddressesDto } from '../dto/addresses.dto';

describe('AddressClassificationsController', () => {
  let controller: AddressClassificationsController;
  let service: jest.Mocked<AddressClassificationsService>;

  beforeEach(async () => {
    const mockService: Partial<jest.Mocked<AddressClassificationsService>> = {
      lookupMany: jest.fn(),
      classifyMissing: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AddressClassificationsController],
      providers: [{ provide: AddressClassificationsService, useValue: mockService }],
    })
      // Override ThrottlerGuard so it doesn't need the throttler module wired up.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AddressClassificationsController);
    service = module.get(AddressClassificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  const PROBED_AT = new Date('2026-09-02T12:00:00.000Z');

  /** A row as the repository returns it — including the BaseEntity columns the
   *  controller deliberately does not put on the wire. */
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 'db-surrogate-id',
      createdAt: PROBED_AT,
      updatedAt: PROBED_AT,
      chain: 'ethereum',
      address: '0xaaa',
      addressType: 'wallet',
      tokenStandard: null,
      symbol: null,
      decimals: null,
      name: null,
      probedAt: PROBED_AT,
      ...overrides,
    } as never;
  }

  /** What that row must look like once serialized: no `id`/`createdAt`/`updatedAt`. */
  function wire(overrides: Record<string, unknown> = {}) {
    return {
      chain: 'ethereum',
      address: '0xaaa',
      addressType: 'wallet',
      tokenStandard: null,
      symbol: null,
      decimals: null,
      name: null,
      probedAt: PROBED_AT,
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------------
  // lookup
  // ---------------------------------------------------------------------------
  describe('lookup', () => {
    it('returns known rows and omits unknown addresses', async () => {
      const found = new Map([['ethereum:0xaaa', row()]]);
      service.lookupMany.mockResolvedValue(found);

      const dto: AddressesDto = {
        addresses: [
          { chain: 'ethereum', address: '0xaaa' },
          { chain: 'ethereum', address: '0xbbb' }, // unknown, not in the map
        ],
      };

      const result = await controller.lookup(dto);

      // Projected to the wire shape: the BaseEntity columns must not leak, and
      // every declared field must be present so both routes agree.
      expect(result).toEqual([wire()]);
    });

    it('drops an empty address and a 64-char hex txid, and still processes the valid remainder', async () => {
      service.lookupMany.mockResolvedValue(new Map());

      const dto: AddressesDto = {
        addresses: [
          { chain: 'bitcoin', address: '' }, // empty address
          {
            chain: 'bitcoin',
            address: 'a'.repeat(64), // tx-junction node: address is a txid, not a real address
          },
          { chain: 'ethereum', address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        ],
      };

      await controller.lookup(dto);

      expect(service.lookupMany).toHaveBeenCalledWith([
        { chain: 'ethereum', address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      ]);
    });

    it('degrades to an empty result when the table does not exist yet (42P01)', async () => {
      service.lookupMany.mockRejectedValue({ code: '42P01' });

      const result = await controller.lookup({
        addresses: [{ chain: 'ethereum', address: '0xaaa' }],
      });

      expect(result).toEqual([]);
    });

    it('propagates an error that is not 42P01', async () => {
      const err = new Error('connection refused');
      service.lookupMany.mockRejectedValue(err);

      await expect(
        controller.lookup({ addresses: [{ chain: 'ethereum', address: '0xaaa' }] }),
      ).rejects.toBe(err);
    });
  });

  // ---------------------------------------------------------------------------
  // classify
  // ---------------------------------------------------------------------------
  describe('classify', () => {
    it('returns { classified, remaining } passthrough from the service', async () => {
      service.classifyMissing.mockResolvedValue({
        classified: [row({ addressType: 'contract', tokenStandard: 'erc20', symbol: 'USDC' })],
        remaining: 3,
      });

      const result = await controller.classify({
        addresses: [{ chain: 'ethereum', address: '0xaaa' }],
      });

      expect(result).toEqual({
        classified: [wire({ addressType: 'contract', tokenStandard: 'erc20', symbol: 'USDC' })],
        remaining: 3,
      });
    });

    // The two routes must serialize identically: `lookup` returns rows read back
    // from the database (which carry BaseEntity columns) while `classify` returns
    // rows that never round-tripped (where they are undefined). Projecting both
    // is what makes the single declared OpenAPI schema honest.
    it('serializes to the same shape as lookup, with no BaseEntity columns', async () => {
      service.lookupMany.mockResolvedValue(new Map([['ethereum:0xaaa', row()]]));
      service.classifyMissing.mockResolvedValue({ classified: [row()], remaining: 0 });

      const dto = { addresses: [{ chain: 'ethereum', address: '0xaaa' }] };
      const looked = await controller.lookup(dto);
      const classified = await controller.classify(dto);

      expect(classified.classified[0]).toEqual(looked[0]);
      for (const key of ['id', 'createdAt', 'updatedAt']) {
        expect(looked[0]).not.toHaveProperty(key);
        expect(classified.classified[0]).not.toHaveProperty(key);
      }
    });

    it('degrades to an empty result when the table does not exist yet (42P01)', async () => {
      service.classifyMissing.mockRejectedValue({ code: '42P01' });

      const result = await controller.classify({
        addresses: [{ chain: 'ethereum', address: '0xaaa' }],
      });

      expect(result).toEqual({ classified: [], remaining: 0 });
    });
  });
});
