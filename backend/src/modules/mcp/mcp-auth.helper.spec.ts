/**
 * McpAuthHelper — unit specs.
 *
 * Covers the four authenticate() outcomes:
 *   (a) no bearer header → `oauth-401`, WWW-Authenticate points at the
 *       resource_metadata URL derived from OAUTH_ISSUER_URL.
 *   (b) valid access token but the owner is now a `guest` in the bound org
 *       → `oauth-401` with `error_description="membership_revoked"`. This is
 *       the per-call eligibility gate (security criterion #2).
 *   (c) valid token + `member` membership → success: principal is
 *       `{ kind: 'mcp', userId, organizationId, sessionId }`, with
 *       `user === session.owner`.
 *   (d) throttle breach → `oauth-401` with `error_description="rate_limited"`.
 *
 * All collaborators (OAuthService, McpThrottleService, OrganizationMember repo,
 * ConfigService) are mocked. The OAuth-only auth path is exercised; no API-key
 * path exists in Daubert V1.
 */

import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OAuthSessionEntity } from '../../database/entities/oauth-session.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { McpThrottleService } from '../../common/throttle/mcp-throttle';
import { OAuthService } from '../oauth/oauth.service';
import { McpAuthHelper, isAuthSuccess } from './mcp-auth.helper';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISSUER = 'https://api.example.com';
const ORG_ID = '00000000-0000-0000-0000-0000000000aa';

const OWNER_USER: UserEntity = {
  id: 'user-001',
  email: 'owner@example.com',
  name: 'Sam Padilla',
} as UserEntity;

const SESSION: OAuthSessionEntity = {
  id: 'session-001',
  ownerUserId: OWNER_USER.id,
  owner: OWNER_USER,
  organizationId: ORG_ID,
  clientId: 'claude-desktop',
  surfaceLabel: 'Claude Desktop',
  accessTokenHash: 'hash',
  refreshTokenHash: 'rhash',
  accessTokenExpiresAt: new Date(Date.now() + 60_000),
  refreshTokenExpiresAt: new Date(Date.now() + 60_000),
  lastUsedAt: null,
  createdAt: new Date(),
  revokedAt: null,
  revokedReason: null,
} as OAuthSessionEntity;

const MEMBER_ROW: OrganizationMemberEntity = {
  id: 'member-001',
  userId: OWNER_USER.id,
  organizationId: ORG_ID,
  role: 'member',
  createdAt: new Date(),
  updatedAt: new Date(),
} as OrganizationMemberEntity;

const GUEST_ROW: OrganizationMemberEntity = {
  ...MEMBER_ROW,
  role: 'guest',
} as OrganizationMemberEntity;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(headers: Record<string, string> = {}): any {
  return { headers };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('McpAuthHelper', () => {
  let helper: McpAuthHelper;
  let oauthService: jest.Mocked<OAuthService>;
  let memberRepo: jest.Mocked<Repository<OrganizationMemberEntity>>;
  let throttle: jest.Mocked<McpThrottleService>;

  beforeEach(async () => {
    const oauthMock = {
      validateAccessToken: jest.fn(),
    } as unknown as jest.Mocked<OAuthService>;

    const memberRepoMock = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<OrganizationMemberEntity>>;

    const throttleMock = {
      hit: jest.fn().mockReturnValue({ allowed: true }),
    } as unknown as jest.Mocked<McpThrottleService>;

    const configMock = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'OAUTH_ISSUER_URL') return ISSUER;
        throw new Error(`Unknown config key: ${key}`);
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpAuthHelper,
        { provide: OAuthService, useValue: oauthMock },
        { provide: McpThrottleService, useValue: throttleMock },
        {
          provide: getRepositoryToken(OrganizationMemberEntity),
          useValue: memberRepoMock,
        },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    helper = module.get(McpAuthHelper);
    oauthService = module.get(OAuthService);
    memberRepo = module.get(getRepositoryToken(OrganizationMemberEntity));
    throttle = module.get(McpThrottleService);
  });

  // -------------------------------------------------------------------------
  // (a) no bearer header
  // -------------------------------------------------------------------------

  describe('no credentials', () => {
    it('returns oauth-401 with resource_metadata pointing at OAUTH_ISSUER_URL', async () => {
      const result = await helper.authenticate(makeReq());
      expect(result.kind).toBe('oauth-401');
      if (result.kind !== 'oauth-401') return;
      expect(result.wwwAuthenticate).toContain(
        `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
      );
      expect(result.wwwAuthenticate).toContain('error="invalid_token"');
      expect(isAuthSuccess(result)).toBe(false);
      expect(oauthService.validateAccessToken).not.toHaveBeenCalled();
    });

    it('returns oauth-401 when Authorization header is malformed (no Bearer scheme)', async () => {
      const result = await helper.authenticate(
        makeReq({ authorization: 'Basic abc' }),
      );
      expect(result.kind).toBe('oauth-401');
      expect(oauthService.validateAccessToken).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (b) valid token but the owner is a guest now
  // -------------------------------------------------------------------------

  describe('per-call eligibility', () => {
    it('returns oauth-401 with membership_revoked when owner has no row in the bound org', async () => {
      oauthService.validateAccessToken.mockResolvedValue(SESSION);
      memberRepo.findOne.mockResolvedValue(null);

      const result = await helper.authenticate(
        makeReq({ authorization: 'Bearer good-token' }),
      );

      expect(result.kind).toBe('oauth-401');
      if (result.kind !== 'oauth-401') return;
      expect(result.wwwAuthenticate).toContain(
        'error_description="membership_revoked"',
      );
      expect(memberRepo.findOne).toHaveBeenCalledWith({
        where: {
          userId: SESSION.ownerUserId,
          organizationId: SESSION.organizationId,
        },
      });
      // Throttle must not be charged for an ineligible session.
      expect(throttle.hit).not.toHaveBeenCalled();
    });

    it('returns oauth-401 with membership_revoked when owner is now a guest in the bound org', async () => {
      oauthService.validateAccessToken.mockResolvedValue(SESSION);
      memberRepo.findOne.mockResolvedValue(GUEST_ROW);

      const result = await helper.authenticate(
        makeReq({ authorization: 'Bearer good-token' }),
      );

      expect(result.kind).toBe('oauth-401');
      if (result.kind !== 'oauth-401') return;
      expect(result.wwwAuthenticate).toContain(
        'error_description="membership_revoked"',
      );
      expect(throttle.hit).not.toHaveBeenCalled();
    });

    it('returns oauth-401 with invalid_token when validateAccessToken returns null', async () => {
      oauthService.validateAccessToken.mockResolvedValue(null);

      const result = await helper.authenticate(
        makeReq({ authorization: 'Bearer stale-token' }),
      );

      expect(result.kind).toBe('oauth-401');
      if (result.kind !== 'oauth-401') return;
      expect(result.wwwAuthenticate).toContain('error="invalid_token"');
      // No membership lookup before the session is even resolved.
      expect(memberRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (c) success
  // -------------------------------------------------------------------------

  describe('success', () => {
    it('returns oauth success with an mcp principal when membership is member', async () => {
      oauthService.validateAccessToken.mockResolvedValue(SESSION);
      memberRepo.findOne.mockResolvedValue(MEMBER_ROW);

      const result = await helper.authenticate(
        makeReq({ authorization: 'Bearer good-token' }),
      );

      expect(isAuthSuccess(result)).toBe(true);
      if (!isAuthSuccess(result)) return;
      expect(result.kind).toBe('oauth');
      expect(result.session).toBe(SESSION);
      expect(result.user).toBe(OWNER_USER);
      expect(result.principal).toEqual({
        kind: 'mcp',
        userId: SESSION.ownerUserId,
        organizationId: SESSION.organizationId,
        sessionId: SESSION.id,
      });
      // Throttle is charged exactly once per authenticated call.
      expect(throttle.hit).toHaveBeenCalledWith(
        `oauth_session:${SESSION.id}`,
        60,
        60,
      );
    });
  });

  // -------------------------------------------------------------------------
  // (d) throttle breach
  // -------------------------------------------------------------------------

  describe('throttle', () => {
    it('returns oauth-401 with rate_limited when the session bucket is exhausted', async () => {
      oauthService.validateAccessToken.mockResolvedValue(SESSION);
      memberRepo.findOne.mockResolvedValue(MEMBER_ROW);
      throttle.hit.mockReturnValue({ allowed: false, retryAfterSec: 30 });

      const result = await helper.authenticate(
        makeReq({ authorization: 'Bearer good-token' }),
      );

      expect(result.kind).toBe('oauth-401');
      if (result.kind !== 'oauth-401') return;
      expect(result.wwwAuthenticate).toContain(
        'error_description="rate_limited"',
      );
      expect(result.wwwAuthenticate).toContain('error="invalid_token"');
    });
  });
});
