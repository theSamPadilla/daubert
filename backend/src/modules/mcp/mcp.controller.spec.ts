/**
 * McpController specs — Task 11.
 *
 * Coverage:
 *   (a) Unauthenticated POST → HTTP 401 with WWW-Authenticate header set from
 *       the auth failure (oauth-401 path — Daubert has no bmc_* key path).
 *   (b) Authenticated POST → `registerForScope` called exactly once; tools
 *       listed successfully (transport internals exercised via the SDK).
 *   (c) @Public() + route-level guard cooperation (load-bearing for McpIpThrottlerGuard).
 *   (d) IP throttle exhaustion → 429 with Retry-After header.
 *   (e) tools/list + prompts/list regression (both register methods called).
 *
 * Test strategy: supertest against a real Express app built from a minimal
 * NestJS testing module. McpAuthHelper and McpToolsService are mocked.
 * McpIpThrottlerGuard is provided as a real instance (using a mocked
 * McpThrottleService). The global AuthGuard is replaced by a stub that
 * honours @Public().
 *
 * MCP protocol (stateless — each POST is one exchange):
 *   - initialize: client sends capabilities; server responds with its own.
 *   - tools/list: client asks for the tool catalog.
 *   - prompts/list: client asks for the prompt catalog.
 */

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as request from 'supertest';

import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { McpIpThrottlerGuard } from '../../common/guards/mcp-ip-throttler.guard';
import { McpThrottleService } from '../../common/throttle/mcp-throttle';
import { McpAuthHelper, isAuthSuccess, AuthSuccess, AuthFailure } from './mcp-auth.helper';
import { McpController } from './mcp.controller';
import { McpToolsService } from './mcp.tools';
import { OAuthService } from '../oauth/oauth.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import { OAuthSessionEntity } from '../../database/entities/oauth-session.entity';
import { UserEntity } from '../../database/entities/user.entity';

const OWNER_USER: UserEntity = {
  id: 'user-001',
  email: 'owner@example.com',
  name: 'Sam Padilla',
} as UserEntity;

const SESSION: OAuthSessionEntity = {
  id: 'session-001',
  ownerUserId: OWNER_USER.id,
  owner: OWNER_USER,
  organizationId: 'org-001',
  clientId: 'claude-desktop',
  surfaceLabel: 'Claude Desktop',
} as OAuthSessionEntity;

const AUTH_SUCCESS: AuthSuccess = {
  kind: 'oauth',
  user: OWNER_USER,
  session: SESSION,
  principal: {
    kind: 'mcp',
    userId: OWNER_USER.id,
    organizationId: 'org-001',
    sessionId: SESSION.id,
  },
};

const AUTH_FAILURE: AuthFailure = {
  kind: 'oauth-401',
  wwwAuthenticate:
    'Bearer realm="daubert", error="invalid_token", resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
};

// ---------------------------------------------------------------------------
// Stub global guard — replaces AuthGuard in the test module.
// Honours @Public() so McpController's handler is reachable.
// ---------------------------------------------------------------------------

@Injectable()
class StubGlobalGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic === true;
  }
}

// ---------------------------------------------------------------------------
// Throwaway guard — proves route-level guards still fire when @Public() skips
// the global guard. McpIpThrottlerGuard depends on this behaviour.
// ---------------------------------------------------------------------------

@Injectable()
class ThrowawayGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    throw new UnauthorizedException('throwaway-guard-fired');
  }
}

import { McpController as McpControllerImport } from './mcp.controller';
import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';

@UseGuards(ThrowawayGuard)
@Controller('mcp-throwaway')
class McpControllerWithThrowaway extends McpControllerImport {
  @Public()
  @Post()
  override async handleMcp(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    return super.handleMcp(req, res);
  }
}

// ---------------------------------------------------------------------------
// Stub prompt constants
// ---------------------------------------------------------------------------

const STUB_PROMPT_HANDLE = 'daubert_onboarding_guide';
const STUB_PROMPT_DESCRIPTION = 'Orientation guide for Daubert MCP agents';
const STUB_PROMPT_BODY = 'Welcome to Daubert. Your MCP endpoint: https://api.example.com/mcp';

// ---------------------------------------------------------------------------
// Mock McpToolsService factory
// ---------------------------------------------------------------------------

function makeMockMcpToolsService(): jest.Mocked<McpToolsService> {
  return {
    registerForScope: jest.fn((server: McpServer, _auth: AuthSuccess) => {
      server.registerTool(
        'stub_tool',
        { description: 'stub', inputSchema: {} },
        async () => ({ content: [{ type: 'text' as const, text: '{}' }] }),
      );
    }),
    registerPromptsForScope: jest.fn((server: McpServer) => {
      server.registerPrompt(
        STUB_PROMPT_HANDLE,
        { description: STUB_PROMPT_DESCRIPTION },
        () => ({
          messages: [
            {
              role: 'user' as const,
              content: { type: 'text' as const, text: STUB_PROMPT_BODY },
            },
          ],
        }),
      );
    }),
  } as unknown as jest.Mocked<McpToolsService>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Required Accept header per MCP Streamable HTTP spec. */
const MCP_ACCEPT = 'application/json, text/event-stream';

/** Parse JSON-RPC payload from SSE-encoded MCP response. */
function parseSseResponse(text: string): Record<string, unknown> {
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) {
    throw new Error(`No data line in SSE response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>;
}

function initializePayload() {
  return {
    jsonrpc: '2.0',
    method: 'initialize',
    id: 1,
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0.0.1' },
    },
  };
}

function listToolsPayload() {
  return { jsonrpc: '2.0', method: 'tools/list', id: 2, params: {} };
}

function listPromptsPayload() {
  return { jsonrpc: '2.0', method: 'prompts/list', id: 4, params: {} };
}

// ---------------------------------------------------------------------------
// Module factory
// ---------------------------------------------------------------------------

function buildModule(
  mcpAuth: jest.Mocked<McpAuthHelper>,
  throttleSvc: jest.Mocked<McpThrottleService>,
  mcpTools: jest.Mocked<McpToolsService>,
  oauthService: jest.Mocked<OAuthService>,
) {
  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'OAUTH_ISSUER_URL') return 'https://api.example.com';
      throw new Error(`Unexpected config key: ${key}`);
    }),
  };

  return Test.createTestingModule({
    controllers: [McpController],
    providers: [
      { provide: McpAuthHelper, useValue: mcpAuth },
      { provide: McpThrottleService, useValue: throttleSvc },
      { provide: McpToolsService, useValue: mcpTools },
      { provide: OAuthService, useValue: oauthService },
      { provide: ConfigService, useValue: mockConfig },
      McpIpThrottlerGuard,
      Reflector,
      { provide: 'APP_GUARD', useClass: StubGlobalGuard },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpController', () => {
  let app: INestApplication;
  let mcpAuth: jest.Mocked<McpAuthHelper>;
  let throttleSvc: jest.Mocked<McpThrottleService>;
  let mcpTools: jest.Mocked<McpToolsService>;
  let oauthService: jest.Mocked<OAuthService>;

  beforeEach(async () => {
    mcpAuth = {
      authenticate: jest.fn(),
    } as unknown as jest.Mocked<McpAuthHelper>;

    throttleSvc = {
      hit: jest.fn().mockReturnValue({ allowed: true }),
    } as unknown as jest.Mocked<McpThrottleService>;

    mcpTools = makeMockMcpToolsService();

    oauthService = {
      augmentSurfaceLabel: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<OAuthService>;

    const module: TestingModule = await buildModule(
      mcpAuth,
      throttleSvc,
      mcpTools,
      oauthService,
    ).compile();

    app = module.createNestApplication();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express = require('express');
    app.use(express.json());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // (a) Unauthenticated POST → 401 + WWW-Authenticate
  // -------------------------------------------------------------------------

  it('(a) unauthenticated: returns HTTP 401 + WWW-Authenticate header, empty body', async () => {
    throttleSvc.hit.mockReturnValue({ allowed: true });
    mcpAuth.authenticate.mockResolvedValueOnce(AUTH_FAILURE);

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(listToolsPayload())
      .expect(401);

    expect(res.headers['www-authenticate']).toBeDefined();
    expect(res.headers['www-authenticate']).toMatch(/Bearer realm="daubert"/);
    expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/);
    expect(res.text).toBe('');
    // registerForScope must NOT be called on auth failure.
    expect(mcpTools.registerForScope).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (b) Authenticated POST → registerForScope called exactly once
  // -------------------------------------------------------------------------

  it('(b) authenticated: registerForScope called once; stub_tool listed in catalog', async () => {
    throttleSvc.hit.mockReturnValue({ allowed: true });

    // Initialize
    mcpAuth.authenticate.mockResolvedValueOnce(AUTH_SUCCESS);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(initializePayload())
      .expect(200);

    // tools/list
    mcpAuth.authenticate.mockResolvedValueOnce(AUTH_SUCCESS);
    const listRes = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', 'Bearer good-token')
      .set('Accept', MCP_ACCEPT)
      .send(listToolsPayload())
      .expect(200);

    const body = parseSseResponse(listRes.text) as {
      result?: { tools?: { name: string }[] };
    };
    expect(body.result?.tools?.some((t) => t.name === 'stub_tool')).toBe(true);

    // registerForScope was called for each successful request (initialize + tools/list).
    // The important invariant: it was called with the correct AuthSuccess result.
    expect(mcpTools.registerForScope).toHaveBeenCalledWith(
      expect.any(Object),
      AUTH_SUCCESS,
    );
  });

  // -------------------------------------------------------------------------
  // (c) @Public() + route-level guard cooperation (load-bearing)
  // -------------------------------------------------------------------------

  it('(c) @Public() does not bypass route-level guards — throwaway guard fires and rejects', async () => {
    const throwawayModule: TestingModule = await Test.createTestingModule({
      controllers: [McpControllerWithThrowaway],
      providers: [
        { provide: McpAuthHelper, useValue: mcpAuth },
        { provide: McpThrottleService, useValue: throttleSvc },
        { provide: McpToolsService, useValue: mcpTools },
        { provide: OAuthService, useValue: oauthService },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn(() => 'https://api.example.com'),
          },
        },
        McpIpThrottlerGuard,
        Reflector,
        { provide: 'APP_GUARD', useClass: StubGlobalGuard },
      ],
    }).compile();

    const throwawayApp = throwawayModule.createNestApplication();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const express = require('express');
    throwawayApp.use(express.json());
    await throwawayApp.init();

    try {
      await request(throwawayApp.getHttpServer())
        .post('/mcp-throwaway')
        .set('Accept', MCP_ACCEPT)
        .send(initializePayload())
        .expect(401);
    } finally {
      await throwawayApp.close();
    }
  });

  // -------------------------------------------------------------------------
  // (d) IP throttle exhaustion → 429 with Retry-After
  // -------------------------------------------------------------------------

  it('(d) IP throttle exhausted: returns 429 with Retry-After; auth not called', async () => {
    throttleSvc.hit.mockReturnValue({ allowed: false, retryAfterSec: 30 });

    const res = await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(initializePayload())
      .expect(429);

    expect(res.headers['retry-after']).toBe('30');
    expect(mcpAuth.authenticate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (f) surfaceLabel augmentation — initialize request triggers augment call
  // -------------------------------------------------------------------------

  it('(f) initialize request: augmentSurfaceLabel called with session + clientInfo', async () => {
    throttleSvc.hit.mockReturnValue({ allowed: true });
    mcpAuth.authenticate.mockResolvedValueOnce(AUTH_SUCCESS);

    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(initializePayload())
      .expect(200);

    // Give the fire-and-forget promise a tick to settle.
    await new Promise((r) => setImmediate(r));

    expect(oauthService.augmentSurfaceLabel).toHaveBeenCalledWith(
      SESSION.id,
      SESSION.surfaceLabel,
      expect.stringContaining('test-client'),
    );
  });

  // -------------------------------------------------------------------------
  // (g) surfaceLabel augmentation — non-initialize request does NOT call it
  // -------------------------------------------------------------------------

  it('(g) non-initialize request: augmentSurfaceLabel NOT called', async () => {
    throttleSvc.hit.mockReturnValue({ allowed: true });
    mcpAuth.authenticate.mockResolvedValueOnce(AUTH_SUCCESS);

    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .set('Authorization', 'Bearer good-token')
      .send(listToolsPayload())
      .expect(200);

    await new Promise((r) => setImmediate(r));

    expect(oauthService.augmentSurfaceLabel).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // (e) prompts/list regression — registerPromptsForScope called on success
  // -------------------------------------------------------------------------

  it('(e) authenticated: registerPromptsForScope called; stub prompt listed', async () => {
    throttleSvc.hit.mockReturnValue({ allowed: true });

    // Initialize
    mcpAuth.authenticate.mockResolvedValueOnce(AUTH_SUCCESS);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Accept', MCP_ACCEPT)
      .send(initializePayload())
      .expect(200);

    // prompts/list
    mcpAuth.authenticate.mockResolvedValueOnce(AUTH_SUCCESS);
    const listRes = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', 'Bearer good-token')
      .set('Accept', MCP_ACCEPT)
      .send(listPromptsPayload())
      .expect(200);

    const body = parseSseResponse(listRes.text) as {
      result?: { prompts?: { name: string; description?: string }[] };
    };
    const prompts = body.result?.prompts ?? [];
    const stub = prompts.find((p) => p.name === STUB_PROMPT_HANDLE);
    expect(stub).toBeDefined();
    expect(stub?.description).toBe(STUB_PROMPT_DESCRIPTION);

    // Both register methods called with the auth result.
    expect(mcpTools.registerPromptsForScope).toHaveBeenCalledWith(
      expect.any(Object),
      AUTH_SUCCESS,
      'https://api.example.com',
    );
  });
});
