/**
 * OAuthService unit tests.
 *
 * All TypeORM repositories are mocked. No real DB calls.
 *
 * Daubert adaptations vs the belong-mc parent:
 *   - `scope` ('admin'|'lo') is replaced by `organizationId: string`. Codes and
 *     sessions carry an organization, never a coarse scope label.
 *   - The internal-email refresh-time gate is replaced with a membership
 *     re-check (refresh-time half of per-call eligibility — see Task 5 spec).
 *   - There is no `users.active` column on Daubert, so `validateAccessToken`
 *     does not gate on it.
 *
 * Coverage:
 *   - issueCode: happy path; non-S256 method rejected; configured TTL applied;
 *     row stores `sha256Hex(rawCode)` as PK (Daubert acceptance criterion `e`).
 *   - exchangeCode: PKCE mismatch (acceptance `a`); concurrent-loss
 *     `update.affected === 0` (acceptance `b`); session row uses hashed tokens.
 *   - exchangeRefreshToken: revoked session triggers chain revocation with
 *     `'refresh_reuse'` (acceptance `d`); missing or guest membership in the
 *     session's org triggers chain revocation with `'membership_revoked'`
 *     (acceptance `g`); happy path rotates tokens.
 *   - validateAccessToken: returns null for revoked or expired sessions
 *     (acceptance `c`); lastUsedAt write-damping.
 *   - registerDynamicClient: rejects non-`none` token_endpoint_auth_method and
 *     `javascript:` redirect URIs (acceptance `f`); happy path persists row.
 *   - revokeSession + revokeAllSessionsForOwner: shape of the soft-revoke UPDATE.
 */

import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import { OAuthClientEntity } from '../../database/entities/oauth-client.entity';
import { OAuthCodeEntity } from '../../database/entities/oauth-code.entity';
import { OAuthConsumedStateEntity } from '../../database/entities/oauth-consumed-state.entity';
import {
  OAuthSessionEntity,
  OAuthSessionRevokedReason,
} from '../../database/entities/oauth-session.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { OAuthInvalidGrantError, OAuthService } from './oauth.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Base64url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-0000000000aa';
const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000bb';

const OWNER_USER: UserEntity = {
  id: 'user-001',
  email: 'owner@example.com',
  name: 'Sam Padilla',
} as UserEntity;

const CLIENT_ROW: OAuthClientEntity = {
  clientId: 'claude-desktop',
  displayName: 'Claude Desktop',
  redirectUris: ['https://claude.ai/oauth/callback'],
  isPublicClient: true,
  isDynamic: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MEMBER_ROW: OrganizationMemberEntity = {
  id: 'member-001',
  userId: OWNER_USER.id,
  organizationId: ORG_ID,
  role: 'member',
  createdAt: new Date(),
  updatedAt: new Date(),
} as OrganizationMemberEntity;

const ADMIN_ROW: OrganizationMemberEntity = {
  ...MEMBER_ROW,
  role: 'admin',
} as OrganizationMemberEntity;

const GUEST_ROW: OrganizationMemberEntity = {
  ...MEMBER_ROW,
  role: 'guest',
} as OrganizationMemberEntity;

const CODE_VERIFIER = 'verifier-abcdef1234567890ABCDEF1234567890';
const CODE_CHALLENGE = sha256Base64url(CODE_VERIFIER);

function makeCodeRow(
  overrides: Partial<OAuthCodeEntity> = {},
): OAuthCodeEntity {
  return {
    code: sha256Hex('raw-code-abc'),
    ownerUserId: OWNER_USER.id,
    organizationId: ORG_ID,
    clientId: 'claude-desktop',
    codeChallenge: CODE_CHALLENGE,
    codeChallengeMethod: 'S256',
    redirectUri: 'https://claude.ai/oauth/callback',
    state: null,
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    ...overrides,
  } as OAuthCodeEntity;
}

function makeSessionRow(
  overrides: Partial<OAuthSessionEntity> = {},
): OAuthSessionEntity {
  return {
    id: 'session-001',
    ownerUserId: OWNER_USER.id,
    organizationId: ORG_ID,
    clientId: 'claude-desktop',
    surfaceLabel: 'Claude Desktop',
    accessTokenHash: sha256Hex('access-token-abc'),
    refreshTokenHash: sha256Hex('refresh-token-abc'),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
    lastUsedAt: null,
    createdAt: new Date(),
    revokedAt: null,
    revokedReason: null,
    owner: OWNER_USER,
    client: CLIENT_ROW,
    organization: { id: ORG_ID } as never,
    ...overrides,
  } as OAuthSessionEntity;
}

// ---------------------------------------------------------------------------
// Mock repo factory
// ---------------------------------------------------------------------------

type MockQb = {
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
  delete: jest.Mock;
  from: jest.Mock;
};

function makeMockQb(affected = 1): MockQb {
  const qb: MockQb = {
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected }),
    delete: jest.fn(),
    from: jest.fn(),
  };
  qb.update.mockReturnValue(qb);
  qb.set.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.delete.mockReturnValue(qb);
  qb.from.mockReturnValue(qb);
  return qb;
}

type MockRepo<T> = {
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function makeRepo<T>(qb?: MockQb): MockRepo<T> {
  const theQb = qb ?? makeMockQb();
  return {
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((v: Partial<T>) => v as T),
    save: jest.fn().mockImplementation((v: T) => Promise.resolve(v)),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue(theQb),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OAuthService', () => {
  let service: OAuthService;
  let codeRepo: MockRepo<OAuthCodeEntity>;
  let sessionRepo: MockRepo<OAuthSessionEntity>;
  let clientRepo: MockRepo<OAuthClientEntity>;
  let consumedStateRepo: MockRepo<OAuthConsumedStateEntity>;
  let memberRepo: MockRepo<OrganizationMemberEntity>;

  beforeEach(async () => {
    codeRepo = makeRepo<OAuthCodeEntity>();
    sessionRepo = makeRepo<OAuthSessionEntity>();
    clientRepo = makeRepo<OAuthClientEntity>();
    consumedStateRepo = makeRepo<OAuthConsumedStateEntity>();
    memberRepo = makeRepo<OrganizationMemberEntity>();

    // Mock manager routes update/create/save calls to the matching repo
    // mocks so call-site assertions on codeRepo.update / sessionRepo.create /
    // sessionRepo.save still apply transparently across `dataSource.transaction`.
    const manager = {
      update: jest.fn((entity: unknown, where: unknown, set: unknown) => {
        if (entity === OAuthCodeEntity)
          return codeRepo.update(where as never, set as never);
        if (entity === OAuthSessionEntity)
          return sessionRepo.update(where as never, set as never);
        throw new Error('Unexpected entity in mock manager.update');
      }),
      create: jest.fn((entity: unknown, v: unknown) => {
        if (entity === OAuthSessionEntity) return sessionRepo.create(v as never);
        if (entity === OAuthCodeEntity) return codeRepo.create(v as never);
        throw new Error('Unexpected entity in mock manager.create');
      }),
      save: jest.fn((entity: unknown, v: unknown) => {
        if (entity === OAuthSessionEntity) return sessionRepo.save(v as never);
        if (entity === OAuthCodeEntity) return codeRepo.save(v as never);
        throw new Error('Unexpected entity in mock manager.save');
      }),
    };

    const dataSource = {
      transaction: jest.fn(
        async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: getRepositoryToken(OAuthCodeEntity),
          useValue: codeRepo,
        },
        {
          provide: getRepositoryToken(OAuthSessionEntity),
          useValue: sessionRepo,
        },
        {
          provide: getRepositoryToken(OAuthClientEntity),
          useValue: clientRepo,
        },
        {
          provide: getRepositoryToken(OAuthConsumedStateEntity),
          useValue: consumedStateRepo,
        },
        {
          provide: getRepositoryToken(OrganizationMemberEntity),
          useValue: memberRepo,
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'OAUTH_ACCESS_TOKEN_TTL_S') return 3600;
              if (key === 'OAUTH_REFRESH_TOKEN_TTL_DAYS') return 30;
              if (key === 'OAUTH_CODE_TTL_S') return 60;
              return fallback;
            }),
            getOrThrow: jest.fn((key: string) => {
              if (key === 'OAUTH_ACCESS_TOKEN_TTL_S') return 3600;
              if (key === 'OAUTH_REFRESH_TOKEN_TTL_DAYS') return 30;
              if (key === 'OAUTH_CODE_TTL_S') return 60;
              throw new Error(`Config key not found: ${key}`);
            }),
          },
        },
      ],
    }).compile();

    service = module.get(OAuthService);
  });

  // -------------------------------------------------------------------------
  // registerDynamicClient — RFC 7591
  // -------------------------------------------------------------------------

  describe('registerDynamicClient()', () => {
    it('happy path: persists row and returns RFC 7591 shape (no client_secret)', async () => {
      const saved: OAuthClientEntity[] = [];
      clientRepo.create.mockImplementation((v) => v as OAuthClientEntity);
      clientRepo.save.mockImplementation(async (v) => {
        saved.push(v as OAuthClientEntity);
        return v as OAuthClientEntity;
      });

      const result = await service.registerDynamicClient({
        client_name: 'Claude Desktop',
        redirect_uris: ['http://127.0.0.1:29352/callback'],
      });

      expect(saved).toHaveLength(1);
      expect(saved[0].isDynamic).toBe(true);
      expect(saved[0].displayName).toBe('Claude Desktop');
      expect(saved[0].clientId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(result.client_id).toBe(saved[0].clientId);
      expect(result.token_endpoint_auth_method).toBe('none');
      expect(result.client_name).toBe('Claude Desktop');
      expect(result).not.toHaveProperty('client_secret');
      expect(typeof result.client_id_issued_at).toBe('number');
    });

    it('defaults client_name when missing', async () => {
      clientRepo.create.mockImplementation((v) => v as OAuthClientEntity);
      clientRepo.save.mockImplementation(async (v) => v as OAuthClientEntity);

      const result = await service.registerDynamicClient({
        redirect_uris: ['https://example.com/cb'],
      });

      expect(result.client_name).toBe('Unnamed MCP client');
    });

    it('accepts https, loopback http, and custom-scheme redirect URIs', async () => {
      clientRepo.create.mockImplementation((v) => v as OAuthClientEntity);
      clientRepo.save.mockImplementation(async (v) => v as OAuthClientEntity);

      await expect(
        service.registerDynamicClient({
          redirect_uris: [
            'https://claude.ai/api/oauth/callback',
            'http://127.0.0.1:51234/callback',
            'http://[::1]:51234/callback',
            'claude://oauth/callback',
          ],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects empty or missing redirect_uris', async () => {
      await expect(
        service.registerDynamicClient({ redirect_uris: [] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        // @ts-expect-error — intentional bad input
        service.registerDynamicClient({}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects plain non-loopback http://', async () => {
      await expect(
        service.registerDynamicClient({
          redirect_uris: ['http://example.com/steal'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects javascript:, data:, file: schemes (acceptance f)', async () => {
      for (const uri of [
        'javascript:alert(1)',
        'data:text/html,<script>',
        'file:///etc/passwd',
      ]) {
        await expect(
          service.registerDynamicClient({ redirect_uris: [uri] }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('rejects non-"none" token_endpoint_auth_method (PKCE-only) (acceptance f)', async () => {
      await expect(
        service.registerDynamicClient({
          redirect_uris: ['https://example.com/cb'],
          token_endpoint_auth_method: 'client_secret_basic',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unknown grant_types', async () => {
      await expect(
        service.registerDynamicClient({
          redirect_uris: ['https://example.com/cb'],
          grant_types: ['password'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects response_types other than ["code"]', async () => {
      await expect(
        service.registerDynamicClient({
          redirect_uris: ['https://example.com/cb'],
          response_types: ['token'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // issueCode
  // -------------------------------------------------------------------------

  describe('issueCode()', () => {
    const baseParams = {
      ownerUserId: OWNER_USER.id,
      clientId: 'claude-desktop',
      organizationId: ORG_ID,
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: 'S256',
      redirectUri: 'https://claude.ai/oauth/callback',
    };

    it('happy path: persists code row scoped to organizationId and returns raw code', async () => {
      codeRepo.create.mockImplementation((v) => v as OAuthCodeEntity);
      codeRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await service.issueCode(baseParams);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(codeRepo.save).toHaveBeenCalledTimes(1);

      const savedArg = codeRepo.create.mock.calls[0][0] as Partial<OAuthCodeEntity>;
      expect(savedArg.codeChallengeMethod).toBe('S256');
      expect(savedArg.ownerUserId).toBe(OWNER_USER.id);
      expect(savedArg.organizationId).toBe(ORG_ID);
      expect(savedArg.clientId).toBe('claude-desktop');
      expect(savedArg.consumedAt).toBeNull();
    });

    it('acceptance e: persists sha256Hex(raw) not the raw code', async () => {
      codeRepo.create.mockImplementation((v) => v as OAuthCodeEntity);
      codeRepo.save.mockImplementation((v) => Promise.resolve(v));

      const rawCode = await service.issueCode(baseParams);

      const savedArg = codeRepo.create.mock.calls[0][0] as Partial<OAuthCodeEntity>;
      expect(savedArg.code).toBe(sha256Hex(rawCode));
      // The raw code must not appear in the persisted row.
      expect(savedArg.code).not.toBe(rawCode);
    });

    it('TTL: expiresAt is ~OAUTH_CODE_TTL_S seconds from now', async () => {
      codeRepo.create.mockImplementation((v) => v as OAuthCodeEntity);
      codeRepo.save.mockImplementation((v) => Promise.resolve(v));

      const before = Date.now();
      await service.issueCode(baseParams);
      const after = Date.now();

      const savedArg = codeRepo.create.mock.calls[0][0] as Partial<OAuthCodeEntity>;
      const expiry = savedArg.expiresAt!.getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 60_000);
      expect(expiry).toBeLessThanOrEqual(after + 60_000 + 100);
    });

    it('rejects non-S256 codeChallengeMethod', async () => {
      await expect(
        service.issueCode({ ...baseParams, codeChallengeMethod: 'plain' }),
      ).rejects.toThrow(BadRequestException);
      expect(codeRepo.save).not.toHaveBeenCalled();
    });

    it('rejects empty codeChallengeMethod', async () => {
      await expect(
        service.issueCode({ ...baseParams, codeChallengeMethod: '' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // exchangeCode
  // -------------------------------------------------------------------------

  describe('exchangeCode()', () => {
    const RAW_CODE = 'raw-code-abc';
    const baseParams = {
      code: RAW_CODE,
      codeVerifier: CODE_VERIFIER,
      clientId: 'claude-desktop',
      redirectUri: 'https://claude.ai/oauth/callback',
    };

    beforeEach(() => {
      clientRepo.findOne.mockResolvedValue(CLIENT_ROW);
    });

    it('happy path: returns tokens; session row stores hashed tokens + organizationId', async () => {
      const codeRow = makeCodeRow();
      codeRepo.findOne.mockResolvedValue(codeRow);
      const savedSession = makeSessionRow({ id: 'new-session-001' });
      sessionRepo.create.mockReturnValue(savedSession);
      sessionRepo.save.mockResolvedValue(savedSession);

      const result = await service.exchangeCode(baseParams);

      expect(result.oauthSessionId).toBe('new-session-001');
      expect(result.organizationId).toBe(ORG_ID);
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');

      const sessionArg = sessionRepo.create.mock.calls[0][0] as Partial<OAuthSessionEntity>;
      expect(sessionArg.accessTokenHash).toBe(sha256Hex(result.accessToken));
      expect(sessionArg.refreshTokenHash).toBe(sha256Hex(result.refreshToken));
      expect(sessionArg.organizationId).toBe(ORG_ID);
      // Raw tokens must never appear in the persisted row.
      expect(sessionArg.accessTokenHash).not.toBe(result.accessToken);
      expect(sessionArg.refreshTokenHash).not.toBe(result.refreshToken);
    });

    it('rejects code not found', async () => {
      codeRepo.findOne.mockResolvedValue(null);

      await expect(service.exchangeCode(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );
    });

    it('rejects expired code', async () => {
      codeRepo.findOne.mockResolvedValue(
        makeCodeRow({ expiresAt: new Date(Date.now() - 1) }),
      );

      await expect(service.exchangeCode(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );
    });

    it('rejects consumed code (single-use)', async () => {
      codeRepo.findOne.mockResolvedValue(
        makeCodeRow({ consumedAt: new Date() }),
      );

      await expect(service.exchangeCode(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );
    });

    it('acceptance a: PKCE mismatch → invalid_grant', async () => {
      codeRepo.findOne.mockResolvedValue(makeCodeRow());

      await expect(
        service.exchangeCode({ ...baseParams, codeVerifier: 'wrong-verifier' }),
      ).rejects.toThrow(OAuthInvalidGrantError);
    });

    it('rejects clientId mismatch', async () => {
      codeRepo.findOne.mockResolvedValue(makeCodeRow());

      await expect(
        service.exchangeCode({ ...baseParams, clientId: 'other-client' }),
      ).rejects.toThrow(OAuthInvalidGrantError);
    });

    it('rejects redirectUri mismatch', async () => {
      codeRepo.findOne.mockResolvedValue(makeCodeRow());

      await expect(
        service.exchangeCode({
          ...baseParams,
          redirectUri: 'https://evil.com/callback',
        }),
      ).rejects.toThrow(OAuthInvalidGrantError);
    });

    it('acceptance b: concurrent exchange (update.affected === 0) → invalid_grant; no session insert', async () => {
      codeRepo.findOne.mockResolvedValue(makeCodeRow());
      codeRepo.update.mockResolvedValueOnce({ affected: 0 });

      await expect(service.exchangeCode(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );

      // Session must NOT have been inserted on the race-loss path.
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('marks code consumed via conditional UPDATE keyed on the stored hash + consumedAt IS NULL', async () => {
      const codeRow = makeCodeRow();
      codeRepo.findOne.mockResolvedValue(codeRow);
      sessionRepo.save.mockResolvedValue(makeSessionRow());

      await service.exchangeCode(baseParams);

      expect(codeRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ code: codeRow.code }),
        expect.objectContaining({ consumedAt: expect.any(Date) }),
      );
    });

    it('surfaceLabel defaults to clientId when client row not found', async () => {
      clientRepo.findOne.mockResolvedValue(null);
      codeRepo.findOne.mockResolvedValue(makeCodeRow());
      sessionRepo.save.mockResolvedValue(makeSessionRow());

      await service.exchangeCode(baseParams);

      const sessionArg = sessionRepo.create.mock.calls[0][0] as Partial<OAuthSessionEntity>;
      expect(sessionArg.surfaceLabel).toBe('claude-desktop');
    });
  });

  // -------------------------------------------------------------------------
  // exchangeRefreshToken
  // -------------------------------------------------------------------------

  describe('exchangeRefreshToken()', () => {
    const RAW_REFRESH = 'refresh-token-abc';
    const baseParams = {
      refreshToken: RAW_REFRESH,
      clientId: 'claude-desktop',
    };

    it('happy path: rotates tokens, updates session, requires non-guest membership', async () => {
      const session = makeSessionRow({
        refreshTokenHash: sha256Hex(RAW_REFRESH),
      });
      sessionRepo.findOne.mockResolvedValue(session);
      memberRepo.findOne.mockResolvedValue(MEMBER_ROW);

      const result = await service.exchangeRefreshToken(baseParams);

      expect(result.oauthSessionId).toBe('session-001');
      expect(result.organizationId).toBe(ORG_ID);
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.refreshToken).toBe('string');

      // New refresh token hash must differ from the old one.
      expect(sha256Hex(result.refreshToken)).not.toBe(sha256Hex(RAW_REFRESH));

      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: 'session-001' },
        expect.objectContaining({
          accessTokenHash: sha256Hex(result.accessToken),
          refreshTokenHash: sha256Hex(result.refreshToken),
          accessTokenExpiresAt: expect.any(Date),
          refreshTokenExpiresAt: expect.any(Date),
          lastUsedAt: expect.any(Date),
        }),
      );
    });

    it('admin membership is also accepted', async () => {
      const session = makeSessionRow({
        refreshTokenHash: sha256Hex(RAW_REFRESH),
      });
      sessionRepo.findOne.mockResolvedValue(session);
      memberRepo.findOne.mockResolvedValue(ADMIN_ROW);

      await expect(
        service.exchangeRefreshToken(baseParams),
      ).resolves.toBeDefined();
    });

    it('rejects when refresh token hash not found (no chain revoke — no session to revoke)', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.exchangeRefreshToken(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );
      expect(sessionRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('rejects expired refresh without chain revoke', async () => {
      const session = makeSessionRow({
        refreshTokenHash: sha256Hex(RAW_REFRESH),
        refreshTokenExpiresAt: new Date(Date.now() - 1),
      });
      sessionRepo.findOne.mockResolvedValue(session);
      memberRepo.findOne.mockResolvedValue(MEMBER_ROW);

      await expect(service.exchangeRefreshToken(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );
      expect(sessionRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('acceptance d: revoked session → chain revocation with refresh_reuse', async () => {
      const session = makeSessionRow({
        refreshTokenHash: sha256Hex(RAW_REFRESH),
        revokedAt: new Date(),
        revokedReason: 'refresh_reuse',
      });
      sessionRepo.findOne.mockResolvedValue(session);

      const qb = makeMockQb(1);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.exchangeRefreshToken(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );

      expect(sessionRepo.createQueryBuilder).toHaveBeenCalled();
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: 'refresh_reuse' }),
      );
      expect(qb.where).toHaveBeenCalledWith(
        'owner_user_id = :ownerUserId AND revoked_at IS NULL',
        { ownerUserId: OWNER_USER.id },
      );
    });

    it('acceptance g: missing membership for session.organizationId → chain revocation with membership_revoked', async () => {
      const session = makeSessionRow({
        refreshTokenHash: sha256Hex(RAW_REFRESH),
      });
      sessionRepo.findOne.mockResolvedValue(session);
      memberRepo.findOne.mockResolvedValue(null);

      const qb = makeMockQb(1);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.exchangeRefreshToken(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );

      expect(sessionRepo.createQueryBuilder).toHaveBeenCalled();
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: 'membership_revoked' }),
      );
      // The lookup must be keyed by the session's owner + organization.
      expect(memberRepo.findOne).toHaveBeenCalledWith({
        where: { userId: OWNER_USER.id, organizationId: ORG_ID },
      });
    });

    it('acceptance g: guest membership → chain revocation with membership_revoked', async () => {
      const session = makeSessionRow({
        refreshTokenHash: sha256Hex(RAW_REFRESH),
      });
      sessionRepo.findOne.mockResolvedValue(session);
      memberRepo.findOne.mockResolvedValue(GUEST_ROW);

      const qb = makeMockQb(1);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.exchangeRefreshToken(baseParams)).rejects.toThrow(
        OAuthInvalidGrantError,
      );

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: 'membership_revoked' }),
      );
    });

    it('rejects clientId mismatch without chain revoke', async () => {
      const session = makeSessionRow({
        refreshTokenHash: sha256Hex(RAW_REFRESH),
        clientId: 'other-client',
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.exchangeRefreshToken({
          ...baseParams,
          clientId: 'claude-desktop',
        }),
      ).rejects.toThrow(OAuthInvalidGrantError);
      expect(sessionRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // validateAccessToken
  // -------------------------------------------------------------------------

  describe('validateAccessToken()', () => {
    const RAW_TOKEN = 'access-token-abc';

    it('happy path: returns session with owner relation', async () => {
      const session = makeSessionRow({
        accessTokenHash: sha256Hex(RAW_TOKEN),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      const result = await service.validateAccessToken(RAW_TOKEN);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('session-001');
      expect(result!.owner.email).toBe(OWNER_USER.email);
    });

    it('returns null when token not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      expect(await service.validateAccessToken(RAW_TOKEN)).toBeNull();
    });

    it('acceptance c: returns null when access token expired', async () => {
      const session = makeSessionRow({
        accessTokenHash: sha256Hex(RAW_TOKEN),
        accessTokenExpiresAt: new Date(Date.now() - 1),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      expect(await service.validateAccessToken(RAW_TOKEN)).toBeNull();
    });

    it('acceptance c: returns null when session is revoked', async () => {
      const session = makeSessionRow({
        accessTokenHash: sha256Hex(RAW_TOKEN),
        revokedAt: new Date(),
        revokedReason: 'user',
      });
      sessionRepo.findOne.mockResolvedValue(session);

      expect(await service.validateAccessToken(RAW_TOKEN)).toBeNull();
    });

    it('lastUsedAt damping: writes when lastUsedAt is null', async () => {
      const session = makeSessionRow({
        accessTokenHash: sha256Hex(RAW_TOKEN),
        lastUsedAt: null,
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await service.validateAccessToken(RAW_TOKEN);
      await new Promise((r) => setImmediate(r));

      expect(sessionRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-001' }),
        { lastUsedAt: expect.any(Date) },
      );
    });

    it('lastUsedAt damping: writes when lastUsedAt is older than 60s', async () => {
      const session = makeSessionRow({
        accessTokenHash: sha256Hex(RAW_TOKEN),
        lastUsedAt: new Date(Date.now() - 120_000),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await service.validateAccessToken(RAW_TOKEN);
      await new Promise((r) => setImmediate(r));

      expect(sessionRepo.update).toHaveBeenCalledTimes(1);
    });

    it('lastUsedAt damping: does NOT write when lastUsedAt is recent (<60s)', async () => {
      const session = makeSessionRow({
        accessTokenHash: sha256Hex(RAW_TOKEN),
        lastUsedAt: new Date(Date.now() - 10_000),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await service.validateAccessToken(RAW_TOKEN);
      await new Promise((r) => setImmediate(r));

      expect(sessionRepo.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // revokeSession
  // -------------------------------------------------------------------------

  describe('revokeSession()', () => {
    it('calls update with revokedAt and reason for user', async () => {
      const qb = makeMockQb(1);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.revokeSession('session-001', 'user');

      expect(qb.update).toHaveBeenCalledWith(OAuthSessionEntity);
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          revokedAt: expect.any(Date),
          revokedReason: 'user',
        }),
      );
      expect(qb.where).toHaveBeenCalledWith(
        'id = :id AND revoked_at IS NULL',
        { id: 'session-001' },
      );
      expect(qb.execute).toHaveBeenCalled();
    });

    it('idempotent: WHERE clause excludes already-revoked rows', async () => {
      const qb = makeMockQb(0);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(
        service.revokeSession('session-001', 'admin'),
      ).resolves.toBeUndefined();
    });

    it('uses reason=admin when specified', async () => {
      const qb = makeMockQb(1);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      await service.revokeSession('session-001', 'admin');

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: 'admin' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // revokeAllSessionsForOwner
  // -------------------------------------------------------------------------

  describe('revokeAllSessionsForOwner()', () => {
    it('revokes live sessions for the owner and returns count', async () => {
      const qb = makeMockQb(3);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const count = await service.revokeAllSessionsForOwner(
        'user-001',
        'admin',
      );

      expect(count).toBe(3);
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          revokedAt: expect.any(Date),
          revokedReason: 'admin',
        }),
      );
      expect(qb.where).toHaveBeenCalledWith(
        'owner_user_id = :ownerUserId AND revoked_at IS NULL',
        { ownerUserId: 'user-001' },
      );
    });

    it('returns 0 when no live sessions exist', async () => {
      const qb = makeMockQb(0);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const count = await service.revokeAllSessionsForOwner(
        'user-no-sessions',
        'owner_deactivated',
      );

      expect(count).toBe(0);
    });

    it('uses the supplied reason enum value', async () => {
      const qb = makeMockQb(2);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const reason: OAuthSessionRevokedReason = 'refresh_reuse';
      await service.revokeAllSessionsForOwner('user-001', reason);

      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({ revokedReason: 'refresh_reuse' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // augmentSurfaceLabel
  // -------------------------------------------------------------------------

  describe('augmentSurfaceLabel()', () => {
    it('updates the row when current label matches the expected default', async () => {
      const qb = makeMockQb(1);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const updated = await service.augmentSurfaceLabel(
        'session-001',
        'Claude Desktop',
        'Claude Desktop 1.2 · macOS',
      );

      expect(updated).toBe(true);
      expect(qb.update).toHaveBeenCalledWith(OAuthSessionEntity);
      expect(qb.set).toHaveBeenCalledWith({
        surfaceLabel: 'Claude Desktop 1.2 · macOS',
      });
      expect(qb.where).toHaveBeenCalledWith(
        'id = :sessionId AND surface_label = :expectedCurrentLabel',
        {
          sessionId: 'session-001',
          expectedCurrentLabel: 'Claude Desktop',
        },
      );
    });

    it('returns false (no-op) when the conditional UPDATE matched zero rows', async () => {
      const qb = makeMockQb(0);
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const updated = await service.augmentSurfaceLabel(
        'session-001',
        'Claude Desktop',
        'Claude Desktop 1.2 · macOS',
      );

      expect(updated).toBe(false);
    });

    it('short-circuits when augmented label equals expected (no DB call)', async () => {
      const updated = await service.augmentSurfaceLabel(
        'session-001',
        'Claude Desktop',
        'Claude Desktop',
      );

      expect(updated).toBe(false);
      expect(sessionRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cleanupExpiredConsumedState
  // -------------------------------------------------------------------------

  describe('cleanupExpiredConsumedState()', () => {
    it('deletes expired rows and returns count', async () => {
      const qb = makeMockQb(5);
      consumedStateRepo.createQueryBuilder.mockReturnValue(qb);

      const count = await service.cleanupExpiredConsumedState();

      expect(count).toBe(5);
      expect(qb.delete).toHaveBeenCalled();
      expect(qb.from).toHaveBeenCalledWith(OAuthConsumedStateEntity);
      expect(qb.where).toHaveBeenCalledWith('expires_at < :now', {
        now: expect.any(Date),
      });
      expect(qb.execute).toHaveBeenCalled();
    });

    it('returns 0 when no expired rows', async () => {
      const qb = makeMockQb(0);
      consumedStateRepo.createQueryBuilder.mockReturnValue(qb);

      const count = await service.cleanupExpiredConsumedState();

      expect(count).toBe(0);
    });
  });

  // OTHER_ORG_ID is referenced for symmetry in future test additions.
  it('fixture sanity', () => {
    expect(OTHER_ORG_ID).not.toBe(ORG_ID);
  });
});
