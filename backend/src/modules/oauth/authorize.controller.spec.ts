/**
 * AuthorizeController unit tests.
 *
 * All dependencies (FIREBASE_ADMIN, UsersService, StateBagService,
 * OAuthService, OAuthClient repo, OrganizationMember repo, ConfigService)
 * are mocked. No real DB or Firebase calls.
 *
 * Coverage focus (per plan Task 7 acceptance criteria):
 *   GET /oauth/authorize
 *     - Happy path: signs bag + redirects to FRONTEND_URL/oauth/consent.
 *     - redirect_uri NOT in client allowlist → 400 BEFORE any Firebase call.
 *     - Unknown client_id → 400 before any Firebase call.
 *     - bad code_challenge_method → 400.
 *     - missing code_challenge → 400.
 *     - response_type=token → 400 unsupported_response_type.
 *     - Missing Firebase session → 302 ${FRONTEND_URL}/login?return_to=...
 *
 *   POST /oauth/authorize/preview
 *     - Happy path: peeks bag, returns client info + eligible orgs.
 *     - eligibleOrgs filters out guests (only admin/member returned).
 *     - missing bag → 400.
 *     - no Firebase session → 401.
 *     - ownerUserId mismatch → 403.
 *     - unknown clientId → 400.
 *
 *   POST /oauth/authorize/complete
 *     - Happy path (member): issueCode called with organizationId; returns
 *       redirectUrl with code= and state=.
 *     - guest membership → 403 + NO issueCode call (eligibility gate).
 *     - non-member (no row) → 403 + NO issueCode call.
 *     - clientState null → no state param in redirectUrl.
 *     - missing bag → 400.
 *     - missing organizationId → 400.
 *     - no Firebase session → 401.
 *     - ownerUserId mismatch → 403.
 *
 *   POST /oauth/authorize/deny
 *     - Happy path: returns deny URL with error=access_denied + state.
 *     - clientState null → no state param.
 *     - missing bag → 400.
 *     - no Firebase session → 401.
 *     - ownerUserId mismatch → 403.
 */

import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Request, Response } from 'express';

import { OAuthClientEntity } from '../../database/entities/oauth-client.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { FIREBASE_ADMIN } from '../auth/firebase-admin.provider';
import { UsersService } from '../users/users.service';
import { AuthorizeController } from './authorize.controller';
import { OAuthService } from './oauth.service';
import { StateBagPayload, StateBagService } from './state-bag.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FRONTEND_URL = 'https://app.daubert.example.com';

const USER: UserEntity = {
  id: 'user-001',
  firebaseUid: 'fb-uid-001',
  email: 'sam@example.com',
  name: 'Sam Padilla',
  avatarUrl: null,
  isSuperAdmin: false,
} as UserEntity;

const OTHER_USER: UserEntity = {
  id: 'user-other',
  firebaseUid: 'fb-uid-other',
  email: 'other@example.com',
  name: 'Other User',
  avatarUrl: null,
  isSuperAdmin: false,
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

const VALID_QUERY = {
  response_type: 'code',
  client_id: 'claude-desktop',
  redirect_uri: 'https://claude.ai/oauth/callback',
  code_challenge: 'abc123challenge',
  code_challenge_method: 'S256',
  state: 'client-state-xyz',
};

const SAMPLE_BAG_PAYLOAD: StateBagPayload = {
  ownerUserId: USER.id,
  clientId: 'claude-desktop',
  redirectUri: 'https://claude.ai/oauth/callback',
  codeChallenge: 'abc123challenge',
  codeChallengeMethod: 'S256',
  clientState: 'client-state-xyz',
  requestedAt: Date.now(),
};

/**
 * The eligibility test (d) requires a user with admin + member + guest
 * memberships, where only the first two should appear in the preview response.
 */
const MEMBERSHIPS_MIXED = [
  {
    id: 'm-1',
    userId: USER.id,
    organizationId: 'org-admin',
    role: 'admin' as const,
    organization: { id: 'org-admin', slug: 'admin-org', name: 'Admin Org' },
  },
  {
    id: 'm-2',
    userId: USER.id,
    organizationId: 'org-member',
    role: 'member' as const,
    organization: {
      id: 'org-member',
      slug: 'member-org',
      name: 'Member Org',
    },
  },
  {
    id: 'm-3',
    userId: USER.id,
    organizationId: 'org-guest',
    role: 'guest' as const,
    organization: { id: 'org-guest', slug: 'guest-org', name: 'Guest Org' },
  },
];

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockFirebase(uid: string | null = USER.firebaseUid) {
  return {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: uid
        ? jest.fn().mockResolvedValue({ uid })
        : jest.fn().mockRejectedValue(new Error('token expired')),
    }),
  };
}

function makeMockUsersService(user: UserEntity | null = USER) {
  return {
    findByFirebaseUid: jest.fn().mockResolvedValue(user),
  };
}

function makeMockStateBag() {
  return {
    sign: jest.fn().mockReturnValue('signed.bag.token'),
    verify: jest.fn().mockResolvedValue(SAMPLE_BAG_PAYLOAD),
    peek: jest.fn().mockReturnValue(SAMPLE_BAG_PAYLOAD),
  };
}

function makeMockOAuthService() {
  return {
    issueCode: jest.fn().mockResolvedValue('raw-auth-code-xyz'),
  };
}

function makeMockClientRepo(client: OAuthClientEntity | null = CLIENT_ROW) {
  return {
    findOne: jest.fn().mockResolvedValue(client),
  };
}

/**
 * The controller's `find` call uses TypeORM's `In(...)` operator for the
 * role filter. `In(...)` returns an object with a `_value` array on it; the
 * mock honors that shape so the eligibility filter is exercised end-to-end.
 */
function extractInValues(operator: unknown): string[] | null {
  if (
    operator !== null &&
    typeof operator === 'object' &&
    '_value' in operator
  ) {
    const v = (operator as { _value: unknown })._value;
    if (Array.isArray(v)) return v as string[];
  }
  return null;
}

function makeMockMemberRepo(
  rows: Array<{
    id: string;
    userId: string;
    organizationId: string;
    role: 'admin' | 'member' | 'guest';
    organization: { id: string; slug: string; name: string };
  }> = MEMBERSHIPS_MIXED,
) {
  return {
    find: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
      const where = (opts?.where ?? {}) as Record<string, unknown>;
      let result = rows;
      if (where.userId) {
        result = result.filter((r) => r.userId === where.userId);
      }
      if (where.role !== undefined) {
        const allowed = extractInValues(where.role);
        if (allowed) {
          result = result.filter((r) => allowed.includes(r.role));
        } else if (typeof where.role === 'string') {
          result = result.filter((r) => r.role === where.role);
        }
      }
      return Promise.resolve(result);
    }),
    findOne: jest.fn().mockImplementation((opts: Record<string, unknown>) => {
      const where = (opts?.where ?? {}) as Record<string, unknown>;
      const match = rows.find(
        (r) =>
          r.userId === where.userId &&
          r.organizationId === where.organizationId,
      );
      return Promise.resolve(match ?? null);
    }),
  };
}

function makeMockRes(): jest.Mocked<Response> {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    redirect: jest.fn(),
  } as unknown as jest.Mocked<Response>;
  res.status.mockReturnValue(res);
  return res;
}

function makeMockReq(
  query: Record<string, unknown> = VALID_QUERY,
  headers: Record<string, string> = {
    authorization: 'Bearer firebase-id-token',
  },
  originalUrl?: string,
): Request {
  return {
    query,
    headers,
    originalUrl: originalUrl ?? '/oauth/authorize',
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Module setup helper
// ---------------------------------------------------------------------------

async function buildModule(overrides: {
  firebase?: object;
  users?: object;
  stateBag?: object;
  oauthService?: object;
  clientRepo?: object;
  memberRepo?: object;
}): Promise<AuthorizeController> {
  const firebase = overrides.firebase ?? makeMockFirebase();
  const users = overrides.users ?? makeMockUsersService();
  const stateBag = overrides.stateBag ?? makeMockStateBag();
  const oauthService = overrides.oauthService ?? makeMockOAuthService();
  const clientRepo = overrides.clientRepo ?? makeMockClientRepo();
  const memberRepo = overrides.memberRepo ?? makeMockMemberRepo();

  const module: TestingModule = await Test.createTestingModule({
    controllers: [AuthorizeController],
    providers: [
      { provide: FIREBASE_ADMIN, useValue: firebase },
      { provide: UsersService, useValue: users },
      { provide: StateBagService, useValue: stateBag },
      { provide: OAuthService, useValue: oauthService },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) => {
            if (key === 'FRONTEND_URL') return FRONTEND_URL;
            return undefined;
          }),
          getOrThrow: jest.fn((key: string) => {
            if (key === 'FRONTEND_URL') return FRONTEND_URL;
            throw new Error(`Config key not found: ${key}`);
          }),
        },
      },
      {
        provide: getRepositoryToken(OAuthClientEntity),
        useValue: clientRepo,
      },
      {
        provide: getRepositoryToken(OrganizationMemberEntity),
        useValue: memberRepo,
      },
    ],
  }).compile();

  return module.get(AuthorizeController);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthorizeController', () => {
  // =========================================================================
  // GET /oauth/authorize
  // =========================================================================

  describe('GET /oauth/authorize', () => {
    it('happy path: signs bag (no scope) + redirects to FRONTEND_URL/oauth/consent', async () => {
      const stateBag = makeMockStateBag();
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(stateBag.sign).toHaveBeenCalledTimes(1);
      const signArg = stateBag.sign.mock.calls[0][0] as StateBagPayload;
      expect(signArg.ownerUserId).toBe(USER.id);
      expect(signArg.clientId).toBe('claude-desktop');
      expect(signArg.redirectUri).toBe('https://claude.ai/oauth/callback');
      expect(signArg.codeChallenge).toBe('abc123challenge');
      expect(signArg.codeChallengeMethod).toBe('S256');
      expect(signArg.clientState).toBe('client-state-xyz');
      expect('scope' in signArg).toBe(false);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const [code, url] = res.redirect.mock.calls[0] as [number, string];
      expect(code).toBe(302);
      expect(url).toContain(`${FRONTEND_URL}/oauth/consent?bag=`);
    });

    it('(a) redirect_uri NOT in client allowlist → 400 BEFORE any Firebase call', async () => {
      const firebase = makeMockFirebase();
      const verifyIdToken = firebase.auth().verifyIdToken;
      const controller = await buildModule({ firebase });
      const req = makeMockReq({
        ...VALID_QUERY,
        redirect_uri: 'https://evil.com/callback',
      });
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const json = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(json.error).toBe('invalid_request');
      expect(json.error_description).toMatch(/redirect_uri/i);
      // Critical: firebase verifyIdToken must NOT have been called.
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    it('unknown client_id → 400 BEFORE any Firebase call', async () => {
      const firebase = makeMockFirebase();
      const verifyIdToken = firebase.auth().verifyIdToken;
      const controller = await buildModule({
        firebase,
        clientRepo: makeMockClientRepo(null),
      });
      const req = makeMockReq({ ...VALID_QUERY, client_id: 'unknown-client' });
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const json = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(json.error).toBe('invalid_request');
      expect(verifyIdToken).not.toHaveBeenCalled();
    });

    it('response_type=token → 400 unsupported_response_type', async () => {
      const controller = await buildModule({});
      const req = makeMockReq({ ...VALID_QUERY, response_type: 'token' });
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const json = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(json.error).toBe('unsupported_response_type');
    });

    it('code_challenge_method=plain → 400 invalid_request', async () => {
      const controller = await buildModule({});
      const req = makeMockReq({
        ...VALID_QUERY,
        code_challenge_method: 'plain',
      });
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const json = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(json.error).toBe('invalid_request');
    });

    it('missing code_challenge → 400 invalid_request', async () => {
      const controller = await buildModule({});
      const { code_challenge: _cc, ...queryWithout } = VALID_QUERY;
      void _cc;
      const req = makeMockReq(queryWithout);
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('missing Firebase session → 302 ${FRONTEND_URL}/login with return_to', async () => {
      const firebase = {
        auth: jest.fn().mockReturnValue({
          verifyIdToken: jest
            .fn()
            .mockRejectedValue(new Error('token expired')),
        }),
      };
      const controller = await buildModule({ firebase });
      const req = makeMockReq(
        VALID_QUERY,
        { authorization: 'Bearer bad-token' },
        '/oauth/authorize?client_id=claude-desktop',
      );
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const [code, url] = res.redirect.mock.calls[0] as [number, string];
      expect(code).toBe(302);
      expect(url).toContain(`${FRONTEND_URL}/login?return_to=`);
    });

    it('no Authorization header → 302 ${FRONTEND_URL}/login with return_to', async () => {
      const controller = await buildModule({});
      const req = makeMockReq(VALID_QUERY, {});
      const res = makeMockRes();

      await controller.authorize(req, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const [code, url] = res.redirect.mock.calls[0] as [number, string];
      expect(code).toBe(302);
      expect(url).toContain(`${FRONTEND_URL}/login?return_to=`);
    });
  });

  // =========================================================================
  // POST /oauth/authorize/preview
  // =========================================================================

  describe('POST /oauth/authorize/preview', () => {
    it('happy path: peeks bag, returns client info and eligibleOrgs', async () => {
      const controller = await buildModule({});
      const req = makeMockReq();

      const result = await controller.preview(req, { bag: 'valid.bag' });

      expect(result.clientId).toBe('claude-desktop');
      expect(result.clientDisplayName).toBe('Claude Desktop');
      expect(result.redirectUri).toBe('https://claude.ai/oauth/callback');
      expect(result.clientState).toBe('client-state-xyz');
      expect(Array.isArray(result.eligibleOrgs)).toBe(true);
    });

    it('(d) eligibleOrgs filters out guest memberships (admin+member only)', async () => {
      const controller = await buildModule({});
      const req = makeMockReq();

      const result = await controller.preview(req, { bag: 'valid.bag' });

      expect(result.eligibleOrgs).toHaveLength(2);
      const ids = result.eligibleOrgs.map((o) => o.id).sort();
      expect(ids).toEqual(['org-admin', 'org-member']);

      const adminOrg = result.eligibleOrgs.find((o) => o.id === 'org-admin');
      expect(adminOrg).toBeDefined();
      expect(adminOrg!.role).toBe('admin');
      expect(adminOrg!.slug).toBe('admin-org');
      expect(adminOrg!.name).toBe('Admin Org');

      const memberOrg = result.eligibleOrgs.find((o) => o.id === 'org-member');
      expect(memberOrg!.role).toBe('member');

      // No guest org should be present.
      expect(result.eligibleOrgs.find((o) => o.id === 'org-guest')).toBeUndefined();
    });

    it('does NOT call stateBag.verify (only peek)', async () => {
      const stateBag = makeMockStateBag();
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();

      await controller.preview(req, { bag: 'valid.bag' });

      expect(stateBag.peek).toHaveBeenCalledTimes(1);
      expect(stateBag.verify).not.toHaveBeenCalled();
    });

    it('missing bag → 400', async () => {
      const controller = await buildModule({});
      const req = makeMockReq();
      await expect(controller.preview(req, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('no Firebase session → 401', async () => {
      const firebase = {
        auth: jest.fn().mockReturnValue({
          verifyIdToken: jest.fn().mockRejectedValue(new Error('no session')),
        }),
      };
      const controller = await buildModule({ firebase });
      const req = makeMockReq();
      await expect(
        controller.preview(req, { bag: 'valid.bag' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('ownerUserId mismatch → 403', async () => {
      const stateBag = {
        ...makeMockStateBag(),
        peek: jest.fn().mockReturnValue({
          ...SAMPLE_BAG_PAYLOAD,
          ownerUserId: OTHER_USER.id,
        }),
      };
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();
      await expect(
        controller.preview(req, { bag: 'mismatched.bag' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('unknown clientId → 400', async () => {
      const controller = await buildModule({
        clientRepo: makeMockClientRepo(null),
      });
      const req = makeMockReq();
      await expect(
        controller.preview(req, { bag: 'valid.bag' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // POST /oauth/authorize/complete
  // =========================================================================

  describe('POST /oauth/authorize/complete', () => {
    it('(c) happy path (member): issueCode called with that organizationId; redirectUrl contains code=', async () => {
      const oauthService = makeMockOAuthService();
      const controller = await buildModule({ oauthService });
      const req = makeMockReq();

      const result = await controller.complete(req, {
        bag: 'valid.bag',
        organizationId: 'org-member',
      });

      expect(oauthService.issueCode).toHaveBeenCalledTimes(1);
      const codeArgs = oauthService.issueCode.mock.calls[0][0] as {
        ownerUserId: string;
        clientId: string;
        organizationId: string;
        codeChallenge: string;
        codeChallengeMethod: string;
        redirectUri: string;
        state?: string | null;
      };
      expect(codeArgs.ownerUserId).toBe(USER.id);
      expect(codeArgs.clientId).toBe('claude-desktop');
      expect(codeArgs.organizationId).toBe('org-member');
      expect(codeArgs.codeChallenge).toBe('abc123challenge');
      expect(codeArgs.codeChallengeMethod).toBe('S256');
      expect(codeArgs.redirectUri).toBe('https://claude.ai/oauth/callback');
      expect(codeArgs.state).toBe('client-state-xyz');

      expect(result.redirectUrl).toContain('https://claude.ai/oauth/callback');
      expect(result.redirectUrl).toContain('code=raw-auth-code-xyz');
      expect(result.redirectUrl).toContain('state=client-state-xyz');
    });

    it('happy path (admin): issueCode called with admin organizationId', async () => {
      const oauthService = makeMockOAuthService();
      const controller = await buildModule({ oauthService });
      const req = makeMockReq();

      await controller.complete(req, {
        bag: 'valid.bag',
        organizationId: 'org-admin',
      });

      expect(oauthService.issueCode).toHaveBeenCalledTimes(1);
      const codeArgs = oauthService.issueCode.mock.calls[0][0] as {
        organizationId: string;
      };
      expect(codeArgs.organizationId).toBe('org-admin');
    });

    it('(b) guest membership for chosen org → 403 + NO issueCode call', async () => {
      const oauthService = makeMockOAuthService();
      const controller = await buildModule({ oauthService });
      const req = makeMockReq();

      await expect(
        controller.complete(req, {
          bag: 'valid.bag',
          organizationId: 'org-guest',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(oauthService.issueCode).not.toHaveBeenCalled();
    });

    it('non-member (no row) for chosen org → 403 + NO issueCode call', async () => {
      const oauthService = makeMockOAuthService();
      const controller = await buildModule({ oauthService });
      const req = makeMockReq();

      await expect(
        controller.complete(req, {
          bag: 'valid.bag',
          organizationId: 'org-does-not-exist',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(oauthService.issueCode).not.toHaveBeenCalled();
    });

    it('clientState null → no state param in redirectUrl', async () => {
      const stateBag = {
        ...makeMockStateBag(),
        verify: jest.fn().mockResolvedValue({
          ...SAMPLE_BAG_PAYLOAD,
          clientState: null,
        }),
      };
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();

      const result = await controller.complete(req, {
        bag: 'valid.bag',
        organizationId: 'org-member',
      });

      expect(result.redirectUrl).toContain('code=');
      expect(result.redirectUrl).not.toContain('state=');
    });

    it('missing bag → 400', async () => {
      const controller = await buildModule({});
      const req = makeMockReq();
      await expect(
        controller.complete(req, { organizationId: 'org-member' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('missing organizationId → 400', async () => {
      const controller = await buildModule({});
      const req = makeMockReq();
      await expect(
        controller.complete(req, { bag: 'valid.bag' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('no Firebase session → 401', async () => {
      const firebase = {
        auth: jest.fn().mockReturnValue({
          verifyIdToken: jest.fn().mockRejectedValue(new Error('no session')),
        }),
      };
      const controller = await buildModule({ firebase });
      const req = makeMockReq();
      await expect(
        controller.complete(req, {
          bag: 'valid.bag',
          organizationId: 'org-member',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('ownerUserId mismatch → 403', async () => {
      const stateBag = {
        ...makeMockStateBag(),
        verify: jest.fn().mockResolvedValue({
          ...SAMPLE_BAG_PAYLOAD,
          ownerUserId: OTHER_USER.id,
        }),
      };
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();
      await expect(
        controller.complete(req, {
          bag: 'mismatched.bag',
          organizationId: 'org-member',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // POST /oauth/authorize/deny
  // =========================================================================

  describe('POST /oauth/authorize/deny', () => {
    it('happy path: returns deny URL with error=access_denied and state', async () => {
      const controller = await buildModule({});
      const req = makeMockReq();

      const result = await controller.deny(req, { bag: 'valid.bag' });

      expect(result.redirectUrl).toContain('https://claude.ai/oauth/callback');
      expect(result.redirectUrl).toContain('error=access_denied');
      expect(result.redirectUrl).toContain('state=');
    });

    it('clientState null → no state param in deny URL', async () => {
      const stateBag = {
        ...makeMockStateBag(),
        verify: jest.fn().mockResolvedValue({
          ...SAMPLE_BAG_PAYLOAD,
          clientState: null,
        }),
      };
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();

      const result = await controller.deny(req, { bag: 'valid.bag' });

      expect(result.redirectUrl).toContain('error=access_denied');
      expect(result.redirectUrl).not.toContain('state=');
    });

    it('calls stateBag.verify (consumes the bag)', async () => {
      const stateBag = makeMockStateBag();
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();

      await controller.deny(req, { bag: 'valid.bag' });

      expect(stateBag.verify).toHaveBeenCalledTimes(1);
      expect(stateBag.peek).not.toHaveBeenCalled();
    });

    it('missing bag → 400', async () => {
      const controller = await buildModule({});
      const req = makeMockReq();
      await expect(controller.deny(req, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('no Firebase session → 401', async () => {
      const firebase = {
        auth: jest.fn().mockReturnValue({
          verifyIdToken: jest.fn().mockRejectedValue(new Error('no session')),
        }),
      };
      const controller = await buildModule({ firebase });
      const req = makeMockReq();
      await expect(controller.deny(req, { bag: 'valid.bag' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('ownerUserId mismatch → 403', async () => {
      const stateBag = {
        ...makeMockStateBag(),
        verify: jest.fn().mockResolvedValue({
          ...SAMPLE_BAG_PAYLOAD,
          ownerUserId: OTHER_USER.id,
        }),
      };
      const controller = await buildModule({ stateBag });
      const req = makeMockReq();
      await expect(
        controller.deny(req, { bag: 'mismatched.bag' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
