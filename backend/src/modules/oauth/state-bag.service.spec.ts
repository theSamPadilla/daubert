/**
 * StateBagService unit tests.
 *
 * The OAuthConsumedStateEntity repository is mocked so no real DB is needed.
 *
 * Coverage:
 *   - sign/verify happy path: verify returns the original payload.
 *   - Tamper rejection: mutated payload.
 *   - Tamper rejection: mutated signature.
 *   - 10-minute TTL expiry rejection.
 *   - Consumed-bag replay rejection (PK violation simulated).
 *   - Missing / short secret throws at boot.
 */

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OAuthConsumedStateEntity } from 'src/database/entities/oauth-consumed-state.entity';
import { StateBagPayload, StateBagService } from './state-bag.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET_32 = 'aaaabbbbccccddddeeeeffffgggghhhh'; // exactly 32 chars

const SAMPLE_PAYLOAD: StateBagPayload = {
  ownerUserId: 'user-001',
  clientId: 'claude-desktop',
  redirectUri: 'https://claude.ai/oauth/callback',
  codeChallenge: 'abc123codeChallenge',
  codeChallengeMethod: 'S256',
  clientState: 'client-opaque-state',
  requestedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeMockConsumedStateRepo() {
  return {
    create: jest.fn((dto: Partial<OAuthConsumedStateEntity>) => dto),
    // insert() is used by verify() — plain INSERT that throws on PK collision.
    insert: jest.fn().mockResolvedValue(undefined),
  };
}

async function buildService(
  secretOverride?: string,
  repo = makeMockConsumedStateRepo(),
): Promise<StateBagService> {
  const secret = secretOverride ?? SECRET_32;
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StateBagService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) => {
            if (key === 'OAUTH_STATE_SECRET') return secret;
            return undefined;
          }),
          getOrThrow: jest.fn((key: string) => {
            if (key === 'OAUTH_STATE_SECRET') return secret;
            throw new Error(`Config key not found: ${key}`);
          }),
        },
      },
      {
        provide: getRepositoryToken(OAuthConsumedStateEntity),
        useValue: repo,
      },
    ],
  }).compile();

  const svc = module.get(StateBagService);
  svc.onModuleInit();
  return svc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StateBagService', () => {
  // =========================================================================
  // Boot guard
  // =========================================================================

  describe('onModuleInit', () => {
    it('throws if OAUTH_STATE_SECRET is not set (getOrThrow throws)', async () => {
      const repo = makeMockConsumedStateRepo();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StateBagService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue(undefined),
              // Simulate real ConfigService.getOrThrow behaviour: throws when
              // the key is absent (env.validation.ts guarantees presence in prod).
              getOrThrow: jest.fn().mockImplementation((key: string) => {
                throw new Error(`Config variable "${key}" is not defined`);
              }),
            },
          },
          {
            provide: getRepositoryToken(OAuthConsumedStateEntity),
            useValue: repo,
          },
        ],
      }).compile();
      const svc = module.get(StateBagService);
      expect(() => svc.onModuleInit()).toThrow('OAUTH_STATE_SECRET');
    });

    it('throws if OAUTH_STATE_SECRET is shorter than 32 chars', async () => {
      const repo = makeMockConsumedStateRepo();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StateBagService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue('tooshort'),
              getOrThrow: jest.fn().mockReturnValue('tooshort'),
            },
          },
          {
            provide: getRepositoryToken(OAuthConsumedStateEntity),
            useValue: repo,
          },
        ],
      }).compile();
      const svc = module.get(StateBagService);
      expect(() => svc.onModuleInit()).toThrow('too short');
    });

    it('succeeds with a 32-char secret', async () => {
      const svc = await buildService();
      expect(svc).toBeTruthy();
    });
  });

  // =========================================================================
  // sign / verify — happy path
  // =========================================================================

  describe('sign + verify', () => {
    it('happy path: verify returns the original payload', async () => {
      const svc = await buildService();
      const bag = svc.sign(SAMPLE_PAYLOAD);
      const result = await svc.verify(bag);
      expect(result.ownerUserId).toBe(SAMPLE_PAYLOAD.ownerUserId);
      expect(result.clientId).toBe(SAMPLE_PAYLOAD.clientId);
      expect(result.redirectUri).toBe(SAMPLE_PAYLOAD.redirectUri);
      expect(result.codeChallenge).toBe(SAMPLE_PAYLOAD.codeChallenge);
      expect(result.codeChallengeMethod).toBe('S256');
      expect(result.clientState).toBe(SAMPLE_PAYLOAD.clientState);
      expect(result.requestedAt).toBe(SAMPLE_PAYLOAD.requestedAt);
    });

    it('happy path: null clientState is preserved', async () => {
      const svc = await buildService();
      const bag = svc.sign({ ...SAMPLE_PAYLOAD, clientState: null });
      const result = await svc.verify(bag);
      expect(result.clientState).toBeNull();
    });

    it('inserts a row into oauth_consumed_state on verify', async () => {
      const repo = makeMockConsumedStateRepo();
      const svc = await buildService(undefined, repo);
      const bag = svc.sign(SAMPLE_PAYLOAD);
      await svc.verify(bag);
      // Service uses insert() (plain INSERT), not save() (upsert).
      expect(repo.insert).toHaveBeenCalledTimes(1);
      const inserted = repo.insert.mock.calls[0][0] as Partial<OAuthConsumedStateEntity>;
      expect(typeof inserted.bagId).toBe('string');
      expect(inserted.bagId!.length).toBe(64); // SHA-256 hex
    });
  });

  // =========================================================================
  // Tamper rejection
  // =========================================================================

  describe('tamper rejection', () => {
    it('throws invalid_or_expired_bag when payload is mutated', async () => {
      const svc = await buildService();
      const bag = svc.sign(SAMPLE_PAYLOAD);
      // Decode the payload half, mutate the JSON, re-encode.
      const [payloadB64, hmacB64] = bag.split('.');
      const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const mutated = JSON.parse(json) as StateBagPayload;
      mutated.ownerUserId = 'attacker';
      const mutatedB64 = Buffer.from(JSON.stringify(mutated), 'utf8').toString(
        'base64url',
      );
      const tamperedBag = `${mutatedB64}.${hmacB64}`;
      await expect(svc.verify(tamperedBag)).rejects.toThrow(
        BadRequestException,
      );
      await expect(svc.verify(tamperedBag)).rejects.toMatchObject({
        message: 'invalid_or_expired_bag',
      });
    });

    it('throws invalid_or_expired_bag when signature is mutated', async () => {
      const svc = await buildService();
      const bag = svc.sign(SAMPLE_PAYLOAD);
      const [payloadB64] = bag.split('.');
      const tamperedBag = `${payloadB64}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
      await expect(svc.verify(tamperedBag)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws invalid_or_expired_bag for a bag with no dot separator', async () => {
      const svc = await buildService();
      await expect(svc.verify('nodot')).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // TTL expiry rejection
  // =========================================================================

  describe('TTL expiry', () => {
    it('throws invalid_or_expired_bag when requestedAt is older than 10 minutes', async () => {
      const svc = await buildService();
      const expiredPayload: StateBagPayload = {
        ...SAMPLE_PAYLOAD,
        requestedAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
      };
      const bag = svc.sign(expiredPayload);
      await expect(svc.verify(bag)).rejects.toThrow(BadRequestException);
      await expect(svc.verify(bag)).rejects.toMatchObject({
        message: 'invalid_or_expired_bag',
      });
    });

    it('accepts a bag at exactly the edge (just inside TTL)', async () => {
      const svc = await buildService();
      // requestedAt 9 minutes 59 seconds ago — inside TTL.
      const freshPayload: StateBagPayload = {
        ...SAMPLE_PAYLOAD,
        requestedAt: Date.now() - 9 * 60 * 1000 - 59_000,
      };
      const bag = svc.sign(freshPayload);
      // Should not throw from TTL (may throw from re-verify if same bag; test first call only)
      const result = await svc.verify(bag);
      expect(result.ownerUserId).toBe(SAMPLE_PAYLOAD.ownerUserId);
    });
  });

  // =========================================================================
  // peek — happy path and rejections
  // =========================================================================

  describe('peek', () => {
    it('happy path: returns the payload without consuming the bag', async () => {
      const repo = makeMockConsumedStateRepo();
      const svc = await buildService(undefined, repo);
      const bag = svc.sign(SAMPLE_PAYLOAD);
      const result = svc.peek(bag);
      expect(result.ownerUserId).toBe(SAMPLE_PAYLOAD.ownerUserId);
      expect(result.clientId).toBe(SAMPLE_PAYLOAD.clientId);
      // No DB write: peek must NOT consume the bag.
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('peek does not prevent a subsequent verify on the same bag', async () => {
      const repo = makeMockConsumedStateRepo();
      const svc = await buildService(undefined, repo);
      const bag = svc.sign(SAMPLE_PAYLOAD);
      // peek twice — neither call writes to the consumed-state table.
      svc.peek(bag);
      svc.peek(bag);
      expect(repo.insert).not.toHaveBeenCalled();
      // verify works afterwards.
      await svc.verify(bag);
      expect(repo.insert).toHaveBeenCalledTimes(1);
    });

    it('throws invalid_or_expired_bag for a tampered payload', async () => {
      const svc = await buildService();
      const bag = svc.sign(SAMPLE_PAYLOAD);
      const [payloadB64, hmacB64] = bag.split('.');
      const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const mutated = JSON.parse(json) as StateBagPayload;
      mutated.ownerUserId = 'attacker';
      const mutatedB64 = Buffer.from(JSON.stringify(mutated), 'utf8').toString(
        'base64url',
      );
      expect(() => svc.peek(`${mutatedB64}.${hmacB64}`)).toThrow(
        BadRequestException,
      );
    });

    it('throws invalid_or_expired_bag for an expired bag', async () => {
      const svc = await buildService();
      const expiredPayload: StateBagPayload = {
        ...SAMPLE_PAYLOAD,
        requestedAt: Date.now() - 11 * 60 * 1000,
      };
      const bag = svc.sign(expiredPayload);
      expect(() => svc.peek(bag)).toThrow(BadRequestException);
      expect(() => svc.peek(bag)).toThrow(
        expect.objectContaining({ message: 'invalid_or_expired_bag' }),
      );
    });
  });

  // =========================================================================
  // Consumed-bag replay rejection
  // =========================================================================

  describe('replay rejection', () => {
    it('throws bag_already_consumed when insert() rejects with code=23505 on the error itself', async () => {
      const repo = makeMockConsumedStateRepo();

      // First call succeeds; second simulates a PK violation with code on the
      // error object directly (TypeORM copies enumerable driverError props onto
      // QueryFailedError).
      let callCount = 0;
      repo.insert.mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          const pkError = Object.assign(new Error('duplicate key'), {
            code: '23505',
          });
          return Promise.reject(pkError);
        }
        return Promise.resolve(undefined);
      });

      const svc = await buildService(undefined, repo);
      const bag = svc.sign(SAMPLE_PAYLOAD);

      // First verify: succeeds.
      await svc.verify(bag);

      // Second verify with same bag: PK violation → bag_already_consumed.
      await expect(svc.verify(bag)).rejects.toThrow(BadRequestException);
      await expect(svc.verify(bag)).rejects.toMatchObject({
        message: 'bag_already_consumed',
      });
    });

    it('throws bag_already_consumed when insert() rejects with code=23505 on driverError', async () => {
      const repo = makeMockConsumedStateRepo();

      // Variant: pg driver attaches code to driverError; TypeORM may NOT copy
      // it to the top-level error in all versions. Verify our defensive check.
      let callCount = 0;
      repo.insert.mockImplementation(() => {
        callCount++;
        if (callCount > 1) {
          const pkError = Object.assign(new Error('duplicate key'), {
            driverError: { code: '23505' },
          });
          return Promise.reject(pkError);
        }
        return Promise.resolve(undefined);
      });

      const svc = await buildService(undefined, repo);
      const bag = svc.sign(SAMPLE_PAYLOAD);

      await svc.verify(bag);

      await expect(svc.verify(bag)).rejects.toThrow(BadRequestException);
      await expect(svc.verify(bag)).rejects.toMatchObject({
        message: 'bag_already_consumed',
      });
    });
  });
});
