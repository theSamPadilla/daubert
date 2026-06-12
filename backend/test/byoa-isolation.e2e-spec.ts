/**
 * E2E: byoa-isolation
 *
 * Proves the four BYOA MCP security acceptance criteria end-to-end against the
 * real backend stack and a real Postgres DB. Drives the actual OAuth 2.1 flow
 * (authorize → consent → token) and then issues real MCP JSON-RPC tool calls
 * over POST /mcp.
 *
 * Criteria asserted:
 *   #1 Cross-org isolation. Tool calls targeting a case in a different org
 *      return a tool error containing `cross_org_access`; no data from the
 *      foreign org leaks into the response. Verified for both a read tool
 *      (`get_case`) and a write tool (`import_transactions`).
 *
 *   #2 Per-call eligibility. After consent and token issuance, downgrading
 *      the user's org-A membership to `guest` causes the very next /mcp POST
 *      with the same access token to fail with HTTP 401 + WWW-Authenticate
 *      `error_description="membership_revoked"`.
 *
 *   #3 OAuth fidelity. Re-using a consumed authorization code fails with
 *      `invalid_grant`; exchanging a fresh code with a wrong PKCE
 *      `code_verifier` fails with `invalid_grant`; a tampered access token is
 *      rejected at /mcp with HTTP 401.
 *
 *   #4 Audit attribution. Every agent mutation, success OR failure, writes an
 *      `agent_audit_log` row with the expected (sessionId, userId, orgId,
 *      action, status) tuple. Covers a successful `create_investigation` on
 *      an editor case and a denied `create_investigation` on a viewer case
 *      (both must produce audit rows — denied with status='error').
 *
 * Test approach
 *   - Bootstrap the entire AppModule so the real OAuth controllers, the real
 *     MCP controller, and all production code paths run unchanged.
 *   - Override only what cannot run in a unit-test context:
 *       * FIREBASE_ADMIN — accepts our synthetic `firebase-uid:<uid>` bearer
 *         token and returns { uid } so the @Public OAuth routes verify the
 *         caller as user U without hitting Google.
 *       * UsersService.findByFirebaseUid — returns our seeded user.
 *   - Seed two orgs, three cases, several memberships and one trace via the
 *     real TypeORM repositories. Clean up in FK-safe order on teardown.
 *   - Use supertest to drive the real HTTP endpoints; SSE-decode the MCP
 *     responses.
 *
 * Env: DATABASE_URL defaults to the dev Postgres at localhost:5433. The other
 * required env vars (FRONTEND_URL, OAUTH_ISSUER_URL, OAUTH_STATE_SECRET, etc.)
 * are set inline below so the test never relies on a developer's .env having
 * been sourced into the jest process.
 */

import { createHash, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Env wiring — MUST run before any module import that calls validateEnv().
// ---------------------------------------------------------------------------

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://daubert:daubert@localhost:5433/daubert';
process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3001';
process.env.OAUTH_ISSUER_URL =
  process.env.OAUTH_ISSUER_URL ?? 'http://localhost:8081';
// 64-hex chars (>=32 required). Fixed for deterministic test runs.
process.env.OAUTH_STATE_SECRET =
  process.env.OAUTH_STATE_SECRET ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY ?? 'sk-ant-test-key-not-used-in-this-e2e';
process.env.ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? 'test';
process.env.TRONSCAN_API_KEY = process.env.TRONSCAN_API_KEY ?? 'test';
process.env.DAUBERT_WEBSITE_API_KEY =
  process.env.DAUBERT_WEBSITE_API_KEY ?? 'test-key-test-key-test';
// Firebase vars are required by validateEnv as an all-or-nothing group. We
// override FIREBASE_ADMIN below so these never get used for real verification.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'test-project';
process.env.FIREBASE_CLIENT_EMAIL =
  process.env.FIREBASE_CLIENT_EMAIL ?? 'firebase-test@example.com';
process.env.FIREBASE_PRIVATE_KEY =
  process.env.FIREBASE_PRIVATE_KEY ?? 'dummy';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as express from 'express';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { AgentAuditLogEntity } from '../src/database/entities/agent-audit-log.entity';
import { CaseEntity } from '../src/database/entities/case.entity';
import { CaseMemberEntity } from '../src/database/entities/case-member.entity';
import { InvestigationEntity } from '../src/database/entities/investigation.entity';
import { OAuthClientEntity } from '../src/database/entities/oauth-client.entity';
import { OAuthSessionEntity } from '../src/database/entities/oauth-session.entity';
import { OrganizationEntity } from '../src/database/entities/organization.entity';
import { OrganizationMemberEntity } from '../src/database/entities/organization-member.entity';
import { TraceEntity } from '../src/database/entities/trace.entity';
import { UserEntity } from '../src/database/entities/user.entity';
import { FIREBASE_ADMIN } from '../src/modules/auth/firebase-admin.provider';
import { UsersService } from '../src/modules/users/users.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Required Accept header per MCP Streamable HTTP spec. */
const MCP_ACCEPT = 'application/json, text/event-stream';

/** Encode a PKCE code_verifier into an S256 code_challenge. */
function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Generate a fresh PKCE verifier (43+ unreserved chars). */
function newPkceVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** Extract the `bag` query param from a /oauth/consent?bag=... redirect URL. */
function extractBagFromConsentUrl(location: string): string {
  const url = new URL(location, 'http://localhost');
  const bag = url.searchParams.get('bag');
  if (!bag) {
    throw new Error(`No bag in consent URL: ${location}`);
  }
  return bag;
}

/** Extract the `code` query param from a final redirectUrl. */
function extractCodeFromRedirect(redirectUrl: string): string {
  // The redirect URI we register is `https://example.com/cb` — URL parsing works.
  const u = new URL(redirectUrl);
  const code = u.searchParams.get('code');
  if (!code) {
    throw new Error(`No code in redirect URL: ${redirectUrl}`);
  }
  return code;
}

/**
 * Decode an MCP SSE-encoded response into its JSON-RPC body.
 * The SDK's StreamableHTTP transport always responds in SSE format for
 * Accept: application/json, text/event-stream.
 */
function parseSseResponse(text: string): Record<string, unknown> {
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) {
    throw new Error(`No data line in SSE response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
}

/**
 * Helper that performs a real MCP `tools/call` over POST /mcp using the given
 * bearer access token. Returns the parsed JSON-RPC body.
 *
 * Calls always succeed at the HTTP layer when the token is valid (the tool's
 * error/success is encoded in the JSON-RPC `result`). When the token is
 * invalid the controller returns HTTP 401 — the caller is responsible for
 * handling that case via the raw supertest call.
 */
async function mcpToolCall(
  app: INestApplication,
  accessToken: string,
  toolName: string,
  args: Record<string, unknown>,
  id = 1,
): Promise<{ status: number; body: Record<string, unknown>; raw: request.Response }> {
  const res = await request(app.getHttpServer())
    .post('/mcp')
    .set('Authorization', `Bearer ${accessToken}`)
    .set('Accept', MCP_ACCEPT)
    .set('Content-Type', 'application/json')
    .send({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

  if (res.status !== 200) {
    return { status: res.status, body: {}, raw: res };
  }
  return { status: 200, body: parseSseResponse(res.text), raw: res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BYOA isolation, eligibility, PKCE, full flow (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;

  // Repos
  let userRepo: Repository<UserEntity>;
  let orgRepo: Repository<OrganizationEntity>;
  let orgMemberRepo: Repository<OrganizationMemberEntity>;
  let caseRepo: Repository<CaseEntity>;
  let caseMemberRepo: Repository<CaseMemberEntity>;
  let investigationRepo: Repository<InvestigationEntity>;
  let traceRepo: Repository<TraceEntity>;
  let clientRepo: Repository<OAuthClientEntity>;
  let sessionRepo: Repository<OAuthSessionEntity>;
  let auditRepo: Repository<AgentAuditLogEntity>;

  // Seed handles
  let userU: UserEntity;
  let orgA: OrganizationEntity;
  let orgB: OrganizationEntity;
  let caseCA1: CaseEntity; // org A, U is editor
  let caseCA2: CaseEntity; // org A, no membership
  let caseCA3: CaseEntity; // org A, U is viewer (for denied-write test)
  let caseCB1: CaseEntity; // org B
  let traceCB1: TraceEntity; // trace inside CB1 (for cross-org import_transactions)
  let oauthClient: OAuthClientEntity;

  const REDIRECT_URI = 'https://example.com/cb';

  // -------------------------------------------------------------------------
  // beforeAll: bootstrap the app + seed DB
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Stub Firebase admin: any Bearer token of the shape `firebase-uid:<uid>`
      // verifies as { uid: <uid> }. Any other token rejects. This lets us drive
      // /oauth/authorize and the consent endpoints as user U without Google.
      .overrideProvider(FIREBASE_ADMIN)
      .useValue({
        auth: () => ({
          verifyIdToken: jest.fn(async (token: string) => {
            const prefix = 'firebase-uid:';
            if (typeof token === 'string' && token.startsWith(prefix)) {
              return { uid: token.slice(prefix.length) };
            }
            throw new Error('invalid firebase token (test stub)');
          }),
        }),
      })
      // Stub UsersService.findByFirebaseUid: look up the user by firebaseUid
      // we set during seeding. Everything else falls through (the real service
      // is not used after this point in the OAuth flow).
      .overrideProvider(UsersService)
      .useValue({
        findByFirebaseUid: jest.fn(async (uid: string) =>
          userRepo.findOneBy({ firebaseUid: uid }),
        ),
        findByEmail: jest.fn(async () => null),
        linkFirebaseUid: jest.fn(async () => null),
      })
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });

    // Mirror main.ts: register body parsers BEFORE app.init so OAuth routes
    // can decode application/x-www-form-urlencoded bodies and the MCP route
    // can decode application/json. Helmet/CORS are not needed in-process.
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ limit: '50mb', extended: true }));

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();

    // ----- repos -----------------------------------------------------------
    userRepo = moduleRef.get<Repository<UserEntity>>(getRepositoryToken(UserEntity));
    orgRepo = moduleRef.get<Repository<OrganizationEntity>>(
      getRepositoryToken(OrganizationEntity),
    );
    orgMemberRepo = moduleRef.get<Repository<OrganizationMemberEntity>>(
      getRepositoryToken(OrganizationMemberEntity),
    );
    caseRepo = moduleRef.get<Repository<CaseEntity>>(getRepositoryToken(CaseEntity));
    caseMemberRepo = moduleRef.get<Repository<CaseMemberEntity>>(
      getRepositoryToken(CaseMemberEntity),
    );
    investigationRepo = moduleRef.get<Repository<InvestigationEntity>>(
      getRepositoryToken(InvestigationEntity),
    );
    traceRepo = moduleRef.get<Repository<TraceEntity>>(getRepositoryToken(TraceEntity));
    clientRepo = moduleRef.get<Repository<OAuthClientEntity>>(
      getRepositoryToken(OAuthClientEntity),
    );
    sessionRepo = moduleRef.get<Repository<OAuthSessionEntity>>(
      getRepositoryToken(OAuthSessionEntity),
    );
    auditRepo = moduleRef.get<Repository<AgentAuditLogEntity>>(
      getRepositoryToken(AgentAuditLogEntity),
    );

    // ----- seed -----------------------------------------------------------
    const stamp = Date.now();

    userU = await userRepo.save(
      userRepo.create({
        name: 'BYOA e2e User U',
        email: `byoa-u-${stamp}@test.invalid`,
        firebaseUid: `byoa-uid-${stamp}`,
      }),
    );

    orgA = await orgRepo.save(
      orgRepo.create({
        name: 'BYOA e2e Org A',
        slug: `byoa-a-${stamp}`,
        deletedAt: null,
      }),
    );
    orgB = await orgRepo.save(
      orgRepo.create({
        name: 'BYOA e2e Org B',
        slug: `byoa-b-${stamp}`,
        deletedAt: null,
      }),
    );

    // U is a `member` of A (eligible to consent for A) and a `guest` of B
    // (NOT eligible to consent for B).
    await orgMemberRepo.save(
      orgMemberRepo.create({ userId: userU.id, organizationId: orgA.id, role: 'member' }),
    );
    await orgMemberRepo.save(
      orgMemberRepo.create({ userId: userU.id, organizationId: orgB.id, role: 'guest' }),
    );

    // Case CA1 in A — U is editor (explicit case_members row).
    caseCA1 = await caseRepo.save(
      caseRepo.create({
        name: 'CA1',
        userId: userU.id,
        orgId: orgA.id,
      }),
    );
    await caseMemberRepo.save(
      caseMemberRepo.create({ userId: userU.id, caseId: caseCA1.id, role: 'editor' }),
    );

    // Case CA2 in A — U has NO membership. Because U is org-`member` of A
    // (implicit case role: `editor`), CA2 is still visible to U via the
    // implicit org-role projection. That's the documented Daubert behaviour;
    // the cross-org gate is what we are asserting, not implicit access.
    caseCA2 = await caseRepo.save(
      caseRepo.create({
        name: 'CA2',
        userId: userU.id,
        orgId: orgA.id,
      }),
    );

    // Case CA3 in A — U is explicit viewer (used for the denied-write test).
    // Explicit `viewer` membership LOWERS the role below the implicit `editor`
    // U would otherwise get from being an org `member` of A. Explicit beats
    // implicit, so the write is denied with a role-violation.
    caseCA3 = await caseRepo.save(
      caseRepo.create({
        name: 'CA3',
        userId: userU.id,
        orgId: orgA.id,
      }),
    );
    await caseMemberRepo.save(
      caseMemberRepo.create({ userId: userU.id, caseId: caseCA3.id, role: 'viewer' }),
    );

    // Case CB1 in B — U is `guest` of B so should be invisible / unreachable
    // through the org-A-bound MCP session.
    caseCB1 = await caseRepo.save(
      caseRepo.create({
        name: 'CB1',
        userId: null,
        orgId: orgB.id,
      }),
    );

    // Trace inside CB1 (we need an investigation first because traces hang
    // off investigation_id). Used to exercise the cross-org write path
    // (import_transactions targets a trace, NOT a case).
    const invCB1 = await investigationRepo.save(
      investigationRepo.create({
        name: 'CB1 inv',
        caseId: caseCB1.id,
      }),
    );
    traceCB1 = await traceRepo.save(
      traceRepo.create({
        name: 'CB1 trace',
        investigationId: invCB1.id,
        data: { nodes: [], edges: [] },
      }),
    );

    // OAuth client (write directly to repo — equivalent to POST /oauth/register).
    oauthClient = await clientRepo.save(
      clientRepo.create({
        clientId: `byoa-e2e-client-${stamp}`,
        displayName: 'BYOA e2e test client',
        redirectUris: [REDIRECT_URI],
        isPublicClient: true,
        isDynamic: false,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // afterAll: FK-safe cleanup
  // -------------------------------------------------------------------------

  afterAll(async () => {
    // Order matters — children before parents, and we delete-by-attribute
    // rather than by-handle so a partial seed (failed mid-beforeAll) still
    // cleans up without a NotFoundError.
    if (auditRepo && sessionRepo) {
      await auditRepo
        .createQueryBuilder()
        .delete()
        .where('user_id = :uid', { uid: userU?.id ?? '00000000-0000-0000-0000-000000000000' })
        .execute();
    }
    if (sessionRepo) {
      await sessionRepo
        .createQueryBuilder()
        .delete()
        .where('owner_user_id = :uid', {
          uid: userU?.id ?? '00000000-0000-0000-0000-000000000000',
        })
        .execute();
    }
    if (traceCB1) await traceRepo.delete({ id: traceCB1.id });
    // Investigations cascade off cases, but explicit delete first keeps the
    // cleanup deterministic against any future cascade-disabled migration.
    if (caseCB1)
      await investigationRepo.delete({ caseId: caseCB1.id });
    if (caseCA3) await caseRepo.delete({ id: caseCA3.id });
    if (caseCA2) await caseRepo.delete({ id: caseCA2.id });
    if (caseCA1) await caseRepo.delete({ id: caseCA1.id });
    if (caseCB1) await caseRepo.delete({ id: caseCB1.id });
    if (orgA)
      await orgMemberRepo.delete({ userId: userU?.id, organizationId: orgA.id });
    if (orgB)
      await orgMemberRepo.delete({ userId: userU?.id, organizationId: orgB.id });
    if (orgA) await orgRepo.delete({ id: orgA.id });
    if (orgB) await orgRepo.delete({ id: orgB.id });
    if (userU) await userRepo.delete({ id: userU.id });
    if (oauthClient) await clientRepo.delete({ clientId: oauthClient.clientId });
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // Helper: run the real OAuth flow end-to-end and return access + refresh
  // -------------------------------------------------------------------------

  /**
   * Drives the OAuth flow as user U through the real controllers and returns
   * the issued tokens plus the verifier/code so individual tests can also
   * exercise replay and wrong-verifier scenarios on adjacent codes.
   */
  async function runOAuthFlow(): Promise<{
    code: string;
    verifier: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const verifier = newPkceVerifier();
    const challenge = pkceChallenge(verifier);
    const state = 'xyz-test-state';

    // 1. GET /oauth/authorize as U → 302 to /oauth/consent?bag=...
    const authRes = await request(app.getHttpServer())
      .get('/oauth/authorize')
      .query({
        response_type: 'code',
        client_id: oauthClient.clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      })
      .set('Authorization', `Bearer firebase-uid:${userU.firebaseUid}`);

    expect(authRes.status).toBe(302);
    const location = authRes.headers.location as string;
    expect(location).toMatch(/\/oauth\/consent\?bag=/);
    const bag = extractBagFromConsentUrl(location);

    // 2. POST /oauth/authorize/complete with { bag, organizationId: orgA.id }
    const completeRes = await request(app.getHttpServer())
      .post('/oauth/authorize/complete')
      .set('Authorization', `Bearer firebase-uid:${userU.firebaseUid}`)
      .set('Content-Type', 'application/json')
      .send({ bag, organizationId: orgA.id });

    expect(completeRes.status).toBe(200);
    const redirectUrl = (completeRes.body as { redirectUrl: string }).redirectUrl;
    expect(redirectUrl).toContain('code=');
    const code = extractCodeFromRedirect(redirectUrl);

    // 3. POST /oauth/token (form-urlencoded) → access_token + refresh_token
    const tokenRes = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: oauthClient.clientId,
        redirect_uri: REDIRECT_URI,
      });

    expect(tokenRes.status).toBe(200);
    const token = tokenRes.body as {
      access_token: string;
      refresh_token: string;
    };
    expect(typeof token.access_token).toBe('string');
    expect(typeof token.refresh_token).toBe('string');

    return {
      code,
      verifier,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    };
  }

  // =========================================================================
  // Cross-org isolation (criterion #1)
  // =========================================================================

  it('criterion #1 — get_case targeting a case in another org returns cross_org_access and no CB1 data', async () => {
    const { accessToken } = await runOAuthFlow();

    const { status, body } = await mcpToolCall(app, accessToken, 'get_case', {
      caseId: caseCB1.id,
    });
    expect(status).toBe(200);

    // Tool error envelope: { result: { content: [...], isError: true } }
    const result = (body as { result?: { content?: { text: string }[]; isError?: boolean } })
      .result;
    expect(result).toBeDefined();
    expect(result?.isError).toBe(true);
    const responseText = JSON.stringify(result);
    expect(responseText).toMatch(/cross_org_access/i);
    // CB1's name must NOT appear in the response — proves no data leak.
    expect(responseText).not.toContain('CB1');
  });

  it('criterion #1 — import_transactions targeting a trace in another org returns cross_org_access and no CB1 data', async () => {
    const { accessToken } = await runOAuthFlow();

    const { status, body } = await mcpToolCall(app, accessToken, 'import_transactions', {
      traceId: traceCB1.id,
      transactions: [
        {
          from: '0x0000000000000000000000000000000000000001',
          to: '0x0000000000000000000000000000000000000002',
          txHash: '0xdeadbeef',
          chain: 'ethereum',
          timestamp: '2026-01-01T00:00:00Z',
          amount: '1',
          token: 'ETH',
        },
      ],
    });
    expect(status).toBe(200);

    const result = (body as { result?: { content?: { text: string }[]; isError?: boolean } })
      .result;
    expect(result?.isError).toBe(true);
    const responseText = JSON.stringify(result);
    expect(responseText).toMatch(/cross_org_access/i);
    expect(responseText).not.toContain('CB1');
  });

  // =========================================================================
  // In-org role enforcement + audit attribution (criterion #4)
  // =========================================================================

  it('list_cases inside org A returns CA1/CA2/CA3 and never CB1', async () => {
    const { accessToken } = await runOAuthFlow();

    const { status, body } = await mcpToolCall(app, accessToken, 'list_cases', {});
    expect(status).toBe(200);

    const result = (body as { result?: { content?: { text: string }[] } }).result;
    expect(result?.content?.[0]?.text).toBeDefined();
    const listed = JSON.parse(result!.content![0]!.text) as Array<{
      id: string;
      name: string;
      role: string;
    }>;

    const ids = new Set(listed.map((c) => c.id));
    expect(ids.has(caseCA1.id)).toBe(true);
    // CA2: U has implicit `editor` via org-`member` of A — list includes it.
    expect(ids.has(caseCA2.id)).toBe(true);
    expect(ids.has(caseCA3.id)).toBe(true);
    // CB1 must not be listed under any circumstance.
    expect(ids.has(caseCB1.id)).toBe(false);
  });

  it('criterion #4 — successful create_investigation on CA1 writes an agent_audit_log row (status=ok)', async () => {
    const { accessToken } = await runOAuthFlow();

    const before = Date.now();
    const { status, body } = await mcpToolCall(app, accessToken, 'create_investigation', {
      caseId: caseCA1.id,
      name: 'BYOA e2e inv on CA1',
    });
    expect(status).toBe(200);

    const result = (body as { result?: { content?: { text: string }[]; isError?: boolean } })
      .result;
    expect(result?.isError).not.toBe(true);
    const created = JSON.parse(result!.content![0]!.text) as { id: string };
    expect(typeof created.id).toBe('string');

    // Find the OAuth session we just minted so we can match the audit row's
    // session_id directly. Most recent live session for U is the one this
    // /mcp call ran under.
    const session = await sessionRepo.findOne({
      where: { ownerUserId: userU.id, organizationId: orgA.id, revokedAt: null as any },
      order: { createdAt: 'DESC' },
    });
    expect(session).toBeTruthy();

    const auditRows = await auditRepo.find({
      where: {
        sessionId: session!.id,
        userId: userU.id,
        organizationId: orgA.id,
        action: 'create_investigation',
        targetRef: `case:${caseCA1.id}`,
        status: 'ok',
      },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const row = auditRows[auditRows.length - 1];
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // Cleanup: the investigation we just created (so afterAll's case-delete
    // cascade doesn't pick up a child).
    await investigationRepo.delete({ id: created.id });
  });

  it('criterion #4 — denied create_investigation on CA3 (viewer) writes an audit row with status=error', async () => {
    const { accessToken } = await runOAuthFlow();

    const { status, body } = await mcpToolCall(app, accessToken, 'create_investigation', {
      caseId: caseCA3.id,
      name: 'should be denied',
    });
    expect(status).toBe(200);

    const result = (body as { result?: { content?: { text: string }[]; isError?: boolean } })
      .result;
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/editor/i);

    const session = await sessionRepo.findOne({
      where: { ownerUserId: userU.id, organizationId: orgA.id, revokedAt: null as any },
      order: { createdAt: 'DESC' },
    });
    expect(session).toBeTruthy();

    const auditRows = await auditRepo.find({
      where: {
        sessionId: session!.id,
        userId: userU.id,
        organizationId: orgA.id,
        action: 'create_investigation',
        targetRef: `case:${caseCA3.id}`,
        status: 'error',
      },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // Per-call eligibility (criterion #2)
  // =========================================================================

  it('criterion #2 — downgrading U to guest in org A revokes access on the next /mcp call (HTTP 401 membership_revoked)', async () => {
    const { accessToken } = await runOAuthFlow();

    // Sanity check: a tool call with the token currently works.
    const ok = await mcpToolCall(app, accessToken, 'list_cases', {});
    expect(ok.status).toBe(200);

    // Downgrade U's org-A membership to guest directly via repo. This is what
    // an admin demoting U would do at the data layer; the per-call helper
    // re-reads this row on every /mcp request and must reject.
    await orgMemberRepo.update(
      { userId: userU.id, organizationId: orgA.id },
      { role: 'guest' },
    );

    try {
      const res = await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Accept', MCP_ACCEPT)
        .set('Content-Type', 'application/json')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_cases', arguments: {} },
        });

      expect(res.status).toBe(401);
      const www = res.headers['www-authenticate'];
      expect(www).toBeDefined();
      expect(String(www)).toMatch(/membership_revoked/);
    } finally {
      // Restore U's member role so later tests in this file (and re-runs) see
      // the seeded baseline.
      await orgMemberRepo.update(
        { userId: userU.id, organizationId: orgA.id },
        { role: 'member' },
      );
    }
  });

  // =========================================================================
  // OAuth fidelity (criterion #3)
  // =========================================================================

  it('criterion #3 — re-using a consumed authorization code returns invalid_grant', async () => {
    const { code, verifier } = await runOAuthFlow();
    // runOAuthFlow already consumed `code` once via /oauth/token. Now try
    // again — must be rejected with invalid_grant.
    const res = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: oauthClient.clientId,
        redirect_uri: REDIRECT_URI,
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_grant');
  });

  it('criterion #3 — exchanging a fresh code with the wrong code_verifier returns invalid_grant', async () => {
    // Mint a brand-new code (do NOT exchange it via runOAuthFlow).
    const verifier = newPkceVerifier();
    const challenge = pkceChallenge(verifier);

    const authRes = await request(app.getHttpServer())
      .get('/oauth/authorize')
      .query({
        response_type: 'code',
        client_id: oauthClient.clientId,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'verifier-mismatch-test',
      })
      .set('Authorization', `Bearer firebase-uid:${userU.firebaseUid}`);
    expect(authRes.status).toBe(302);
    const bag = extractBagFromConsentUrl(authRes.headers.location as string);

    const completeRes = await request(app.getHttpServer())
      .post('/oauth/authorize/complete')
      .set('Authorization', `Bearer firebase-uid:${userU.firebaseUid}`)
      .set('Content-Type', 'application/json')
      .send({ bag, organizationId: orgA.id });
    expect(completeRes.status).toBe(200);
    const code = extractCodeFromRedirect(
      (completeRes.body as { redirectUrl: string }).redirectUrl,
    );

    // Exchange with a WRONG verifier (different random value).
    const wrongVerifier = newPkceVerifier();
    expect(wrongVerifier).not.toBe(verifier);

    const res = await request(app.getHttpServer())
      .post('/oauth/token')
      .type('form')
      .send({
        grant_type: 'authorization_code',
        code,
        code_verifier: wrongVerifier,
        client_id: oauthClient.clientId,
        redirect_uri: REDIRECT_URI,
      });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_grant');
  });

  it('criterion #3 — a tampered access token is rejected at POST /mcp with HTTP 401', async () => {
    const { accessToken } = await runOAuthFlow();

    // Flip one character (last char) of the token — must not match any hash.
    const lastChar = accessToken[accessToken.length - 1];
    const flipped = lastChar === 'A' ? 'B' : 'A';
    const tampered = accessToken.slice(0, -1) + flipped;
    expect(tampered).not.toBe(accessToken);

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${tampered}`)
      .set('Accept', MCP_ACCEPT)
      .set('Content-Type', 'application/json')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_cases', arguments: {} },
      });

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
  });
});
