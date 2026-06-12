/**
 * OAuthConnectController unit tests.
 *
 * Covers:
 *  - POST /me/oauth/start-connect: returns expected shape, mcpUrl matches
 *    ${OAUTH_ISSUER_URL}/mcp, no token material in the response.
 *  - GET /me/oauth-sessions: returns only the caller's non-revoked sessions
 *    (key requirement: user isolation + revoked-filter).
 *  - POST /me/oauth-sessions/:id/revoke: ownership-checked revoke — 404 when
 *    session belongs to a different user.
 *
 * Global guards (Firebase AuthGuard) are NOT re-tested here — they are
 * exercised in auth.guard.spec.ts. The controller relies on req.user being set
 * by the global AuthGuard before the handler runs.
 */

import {
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import * as request from 'supertest';

import { AgentAuditLogEntity } from '../../database/entities/agent-audit-log.entity';
import { OAuthSessionEntity } from '../../database/entities/oauth-session.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { OAuthConnectController } from './connect.controller';
import { OAuthService } from './oauth.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OAUTH_ISSUER_URL = 'https://api.example.com';
const MCP_URL = `${OAUTH_ISSUER_URL}/mcp`;

const MOCK_USER = {
  id: 'user-001',
  email: 'alice@example.com',
  name: 'Alice',
} as UserEntity;

const OTHER_USER = {
  id: 'user-other-999',
  email: 'other@example.com',
  name: 'Other',
} as UserEntity;

const NOW = new Date('2026-05-15T10:00:00Z');
const EARLIER = new Date('2026-05-14T08:00:00Z');

const SESSION_A = {
  id: 'session-a-001',
  ownerUserId: MOCK_USER.id,
  organizationId: 'org-001',
  clientId: 'claude-desktop',
  surfaceLabel: 'Claude Desktop',
  accessTokenHash: 'hash-a',
  refreshTokenHash: 'rhash-a',
  accessTokenExpiresAt: new Date(Date.now() + 3600_000),
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86400_000),
  lastUsedAt: EARLIER,
  createdAt: EARLIER,
  revokedAt: null,
  revokedReason: null,
} as unknown as OAuthSessionEntity;

const SESSION_B_REVOKED = {
  id: 'session-b-revoked',
  ownerUserId: MOCK_USER.id,
  organizationId: 'org-001',
  clientId: 'claude-web',
  surfaceLabel: 'Claude (Web)',
  accessTokenHash: 'hash-b',
  refreshTokenHash: 'rhash-b',
  accessTokenExpiresAt: new Date('2026-04-01T00:00:00Z'),
  refreshTokenExpiresAt: new Date('2026-04-01T00:00:00Z'),
  lastUsedAt: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  revokedAt: new Date('2026-04-02T00:00:00Z'),
  revokedReason: 'user',
} as unknown as OAuthSessionEntity;

const SESSION_OTHER_USER = {
  id: 'session-other-001',
  ownerUserId: OTHER_USER.id,
  organizationId: 'org-002',
  clientId: 'claude-desktop',
  surfaceLabel: 'Claude Desktop',
  accessTokenHash: 'hash-other',
  refreshTokenHash: 'rhash-other',
  accessTokenExpiresAt: new Date(Date.now() + 3600_000),
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 86400_000),
  lastUsedAt: null,
  createdAt: NOW,
  revokedAt: null,
  revokedReason: null,
} as unknown as OAuthSessionEntity;

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeConfig(issuer = OAUTH_ISSUER_URL): jest.Mocked<ConfigService> {
  return {
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (key === 'OAUTH_ISSUER_URL') return issuer;
      throw new Error(`Unexpected config key: ${key}`);
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function makeOAuthService(): jest.Mocked<OAuthService> {
  return {
    revokeSession: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<OAuthService>;
}

type MockSessionRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
};

function makeSessionRepo(
  findResult: OAuthSessionEntity[] = [],
  findOneResult: OAuthSessionEntity | null = null,
): MockSessionRepo {
  return {
    find: jest.fn().mockResolvedValue(findResult),
    findOne: jest.fn().mockResolvedValue(findOneResult),
  };
}

type MockAuditRepo = {
  find: jest.Mock;
};

function makeAuditRepo(findResult: unknown[] = []): MockAuditRepo {
  return {
    find: jest.fn().mockResolvedValue(findResult),
  };
}

const AUDIT_ROW_OK = {
  id: 'audit-001',
  sessionId: SESSION_A.id,
  userId: MOCK_USER.id,
  organizationId: 'org-001',
  action: 'create_investigation',
  targetRef: 'case:case-001',
  status: 'ok',
  detail: null,
  createdAt: NOW,
} as unknown as AgentAuditLogEntity;

const AUDIT_ROW_ORPHAN = {
  id: 'audit-002',
  sessionId: 'session-gone',
  userId: MOCK_USER.id,
  organizationId: 'org-001',
  action: 'import_transactions',
  targetRef: 'trace:trace-001',
  status: 'error',
  detail: { message: 'denied' },
  createdAt: EARLIER,
} as unknown as AgentAuditLogEntity;

// ---------------------------------------------------------------------------
// Unit tests — controller methods called directly
// ---------------------------------------------------------------------------

describe('OAuthConnectController (unit)', () => {
  let controller: OAuthConnectController;
  let config: jest.Mocked<ConfigService>;
  let oauthService: jest.Mocked<OAuthService>;
  let sessionRepo: MockSessionRepo;
  let auditRepo: MockAuditRepo;

  async function buildModule(
    repoOverride?: MockSessionRepo,
    auditOverride?: MockAuditRepo,
  ): Promise<void> {
    const repo = repoOverride ?? makeSessionRepo();
    const audit = auditOverride ?? makeAuditRepo();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthConnectController],
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: OAuthService, useValue: oauthService },
        {
          provide: getRepositoryToken(OAuthSessionEntity),
          useValue: repo,
        },
        {
          provide: getRepositoryToken(AgentAuditLogEntity),
          useValue: audit,
        },
      ],
    }).compile();
    controller = module.get(OAuthConnectController);
  }

  beforeEach(async () => {
    config = makeConfig();
    oauthService = makeOAuthService();
    sessionRepo = makeSessionRepo();
    auditRepo = makeAuditRepo();
    await buildModule(sessionRepo, auditRepo);
  });

  // -------------------------------------------------------------------------
  // startConnect
  // -------------------------------------------------------------------------

  describe('startConnect()', () => {
    it('returns mcpUrl equal to ${OAUTH_ISSUER_URL}/mcp', () => {
      const result = controller.startConnect();

      expect(result.mcpUrl).toBe(MCP_URL);
    });

    it('response does NOT contain any token material', () => {
      const result = controller.startConnect();
      const json = JSON.stringify(result);

      expect(json).not.toMatch(/Bearer /);
      expect(Object.keys(result)).toEqual(['mcpUrl', 'perSurfaceInstructions']);
    });

    it('claudeApps has ordered steps referencing Connectors and Add custom connector, plus a Team/Enterprise note', () => {
      const result = controller.startConnect();
      const apps = result.perSurfaceInstructions.claudeApps;

      expect(Array.isArray(apps.steps)).toBe(true);
      expect(apps.steps.length).toBeGreaterThanOrEqual(3);
      const joined = apps.steps.join(' ');
      expect(joined).toContain('Connectors');
      expect(joined).toContain('Add custom connector');
      expect(apps.note).toContain('Organization settings');
      expect(apps.command).toBeUndefined();
    });

    it('claudeCode carries the CLI command with --transport http and the mcpUrl', () => {
      const result = controller.startConnect();
      const code = result.perSurfaceInstructions.claudeCode;

      expect(Array.isArray(code.steps)).toBe(true);
      expect(code.command).toContain('claude mcp add');
      expect(code.command).toContain('--transport http');
      expect(code.command).toContain(MCP_URL);
    });

    it('exposes exactly two surface keys (claudeApps + claudeCode)', () => {
      const result = controller.startConnect();

      expect(Object.keys(result.perSurfaceInstructions).sort()).toEqual([
        'claudeApps',
        'claudeCode',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // listSessions
  // -------------------------------------------------------------------------

  describe('listSessions()', () => {
    it("returns only the caller's active sessions — query uses revokedAt: IsNull()", async () => {
      sessionRepo.find.mockResolvedValueOnce([SESSION_A]);

      const result = await controller.listSessions({ user: MOCK_USER } as any);

      expect(sessionRepo.find).toHaveBeenCalledWith({
        where: { ownerUserId: MOCK_USER.id, revokedAt: IsNull() },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(SESSION_A.id);
    });

    it('maps session fields to DTO — no token hashes exposed', async () => {
      sessionRepo.find.mockResolvedValueOnce([SESSION_A]);

      const result = await controller.listSessions({ user: MOCK_USER } as any);
      const dto = result[0];

      expect(dto.id).toBe(SESSION_A.id);
      expect(dto.organizationId).toBe(SESSION_A.organizationId);
      expect(dto.surfaceLabel).toBe(SESSION_A.surfaceLabel);
      expect(dto.lastUsedAt).toBe(EARLIER.toISOString());
      expect(dto.createdAt).toBe(EARLIER.toISOString());

      // Must never expose token hashes
      expect(dto).not.toHaveProperty('accessTokenHash');
      expect(dto).not.toHaveProperty('refreshTokenHash');
    });

    it('maps null lastUsedAt to null', async () => {
      const sessionNoLastUsed = {
        ...SESSION_A,
        id: 'session-no-last-used',
        lastUsedAt: null,
      } as unknown as OAuthSessionEntity;
      sessionRepo.find.mockResolvedValueOnce([sessionNoLastUsed]);

      const result = await controller.listSessions({ user: MOCK_USER } as any);

      expect(result[0].lastUsedAt).toBeNull();
    });

    it('returns empty array when caller has no active sessions', async () => {
      sessionRepo.find.mockResolvedValueOnce([]);

      const result = await controller.listSessions({ user: MOCK_USER } as any);

      expect(result).toEqual([]);
    });

    it('throws UnauthorizedException when user is undefined', async () => {
      await expect(
        controller.listSessions({ user: undefined } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user has no id', async () => {
      await expect(
        controller.listSessions({ user: {} } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // -------------------------------------------------------------------------
  // listAgentActions
  // -------------------------------------------------------------------------

  describe('listAgentActions()', () => {
    it("queries only the caller's rows, newest first, capped at 50", async () => {
      auditRepo.find.mockResolvedValueOnce([AUDIT_ROW_OK]);
      sessionRepo.find.mockResolvedValueOnce([SESSION_A]);

      const result = await controller.listAgentActions({
        user: MOCK_USER,
      } as any);

      expect(auditRepo.find).toHaveBeenCalledWith({
        where: { userId: MOCK_USER.id },
        order: { createdAt: 'DESC' },
        take: 50,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: AUDIT_ROW_OK.id,
        sessionId: SESSION_A.id,
        agentLabel: SESSION_A.surfaceLabel,
        action: 'create_investigation',
        targetRef: 'case:case-001',
        status: 'ok',
      });
    });

    it("resolves a missing session to 'Unknown agent'", async () => {
      auditRepo.find.mockResolvedValueOnce([AUDIT_ROW_ORPHAN]);
      sessionRepo.find.mockResolvedValueOnce([]);

      const result = await controller.listAgentActions({
        user: MOCK_USER,
      } as any);

      expect(result[0].agentLabel).toBe('Unknown agent');
      expect(result[0].status).toBe('error');
    });

    it('returns empty array without a session lookup when there are no rows', async () => {
      auditRepo.find.mockResolvedValueOnce([]);

      const result = await controller.listAgentActions({
        user: MOCK_USER,
      } as any);

      expect(result).toEqual([]);
      expect(sessionRepo.find).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when user is undefined', async () => {
      await expect(
        controller.listAgentActions({ user: undefined } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // -------------------------------------------------------------------------
  // revokeSession
  // -------------------------------------------------------------------------

  describe('revokeSession()', () => {
    it('revokes the session when it belongs to the caller and is active', async () => {
      sessionRepo.findOne.mockResolvedValueOnce(SESSION_A);

      await controller.revokeSession(SESSION_A.id, { user: MOCK_USER } as any);

      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: SESSION_A.id, ownerUserId: MOCK_USER.id },
      });
      expect(oauthService.revokeSession).toHaveBeenCalledWith(
        SESSION_A.id,
        'user',
      );
    });

    it('is idempotent — already-revoked session returns without calling revokeSession', async () => {
      sessionRepo.findOne.mockResolvedValueOnce(SESSION_B_REVOKED);

      await expect(
        controller.revokeSession(SESSION_B_REVOKED.id, { user: MOCK_USER } as any),
      ).resolves.toBeUndefined();

      expect(oauthService.revokeSession).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when session belongs to a different user', async () => {
      // findOne returns null because ownerUserId filter excludes other user's sessions
      sessionRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        controller.revokeSession(SESSION_OTHER_USER.id, { user: MOCK_USER } as any),
      ).rejects.toThrow(NotFoundException);

      expect(oauthService.revokeSession).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when session id is unknown', async () => {
      sessionRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        controller.revokeSession('nonexistent-id', { user: MOCK_USER } as any),
      ).rejects.toThrow(NotFoundException);

      expect(oauthService.revokeSession).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when user is undefined', async () => {
      await expect(
        controller.revokeSession('some-id', { user: undefined } as any),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP layer tests
// ---------------------------------------------------------------------------

async function buildApp(
  config: jest.Mocked<ConfigService>,
  oauthService: jest.Mocked<OAuthService>,
  sessionRepo: MockSessionRepo,
  auditRepo: MockAuditRepo = makeAuditRepo(),
): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    controllers: [OAuthConnectController],
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: OAuthService, useValue: oauthService },
      {
        provide: getRepositoryToken(OAuthSessionEntity),
        useValue: sessionRepo,
      },
      {
        provide: getRepositoryToken(AgentAuditLogEntity),
        useValue: auditRepo,
      },
    ],
  }).compile();

  return mod.createNestApplication();
}

// ---------------------------------------------------------------------------
// HTTP — authenticated Firebase caller (happy paths)
// ---------------------------------------------------------------------------

describe('OAuthConnectController (HTTP — authenticated caller)', () => {
  let app: INestApplication;
  let config: jest.Mocked<ConfigService>;
  let oauthService: jest.Mocked<OAuthService>;
  let sessionRepo: MockSessionRepo;

  beforeEach(async () => {
    config = makeConfig();
    oauthService = makeOAuthService();
    sessionRepo = makeSessionRepo([SESSION_A], SESSION_A);

    app = await buildApp(config, oauthService, sessionRepo);

    // Simulate what the global AuthGuard does on a valid Firebase session
    app.use((req: Record<string, unknown>, _: unknown, next: () => void) => {
      req.user = MOCK_USER;
      next();
    });

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /me/oauth/start-connect → 200 with mcpUrl and perSurfaceInstructions', async () => {
    const res = await request(app.getHttpServer())
      .post('/me/oauth/start-connect')
      .expect(200);

    expect(res.body.mcpUrl).toBe(MCP_URL);
    expect(res.body.perSurfaceInstructions).toHaveProperty('claudeApps');
    expect(res.body.perSurfaceInstructions).toHaveProperty('claudeCode');
  });

  it('GET /me/oauth-sessions → 200 with session array (no token hashes)', async () => {
    const res = await request(app.getHttpServer())
      .get('/me/oauth-sessions')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(SESSION_A.id);
    expect(res.body[0]).not.toHaveProperty('accessTokenHash');
    expect(res.body[0]).not.toHaveProperty('refreshTokenHash');
  });

  it('POST /me/oauth-sessions/:id/revoke → 200 and calls revokeSession', async () => {
    await request(app.getHttpServer())
      .post(`/me/oauth-sessions/${SESSION_A.id}/revoke`)
      .expect(200);

    expect(oauthService.revokeSession).toHaveBeenCalledWith(SESSION_A.id, 'user');
  });
});

// ---------------------------------------------------------------------------
// HTTP — unauthenticated request (no user on req)
// ---------------------------------------------------------------------------

describe('OAuthConnectController (HTTP — unauthenticated)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const config = makeConfig();
    const oauthService = makeOAuthService();
    const sessionRepo = makeSessionRepo();

    app = await buildApp(config, oauthService, sessionRepo);
    // No middleware — req.user stays undefined
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /me/oauth-sessions with no user → 401', async () => {
    await request(app.getHttpServer()).get('/me/oauth-sessions').expect(401);
  });

  it('POST /me/oauth-sessions/:id/revoke with no user → 401', async () => {
    await request(app.getHttpServer())
      .post('/me/oauth-sessions/some-id/revoke')
      .expect(401);
  });
});
