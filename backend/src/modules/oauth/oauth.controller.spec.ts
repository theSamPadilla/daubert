/**
 * OAuthController unit tests.
 *
 * All OAuthService methods are mocked. No real DB or config reads.
 *
 * Coverage:
 *   - POST /oauth/token — authorization_code happy path: RFC 6749 §5.1 shape.
 *   - POST /oauth/token — refresh_token happy path.
 *   - POST /oauth/token — unknown grant_type → 400 unsupported_grant_type.
 *   - POST /oauth/token — missing required params → 400 invalid_request.
 *   - POST /oauth/token — OAuthInvalidGrantError from service → 400 invalid_grant.
 *   - POST /oauth/revoke — happy path → 200 empty.
 *   - POST /oauth/revoke — unknown token → 200 empty (no leak, RFC 7009 §2.2).
 *   - POST /oauth/register — delegates to service, returns RFC 7591 shape.
 *   - GET /.well-known/oauth-authorization-server — correct issuer + endpoints.
 *   - GET /.well-known/oauth-protected-resource — correct resource + auth servers.
 */

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { McpIpThrottlerGuard } from '../../common/guards/mcp-ip-throttler.guard';
import { OAuthController } from './oauth.controller';
import {
  OAuthInvalidGrantError,
  OAuthService,
  TokenResult,
} from './oauth.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISSUER = 'https://api.daubert.example.com';

const TOKEN_RESULT: TokenResult = {
  accessToken: 'raw-access-abc',
  refreshToken: 'raw-refresh-abc',
  accessTokenExpiresAt: new Date(Date.now() + 3600_000),
  refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
  organizationId: 'org-001',
  oauthSessionId: 'session-001',
};

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeMockOAuthService(): jest.Mocked<
  Pick<
    OAuthService,
    | 'exchangeCode'
    | 'exchangeRefreshToken'
    | 'revokeByToken'
    | 'registerDynamicClient'
  >
> {
  return {
    exchangeCode: jest.fn().mockResolvedValue(TOKEN_RESULT),
    exchangeRefreshToken: jest.fn().mockResolvedValue(TOKEN_RESULT),
    revokeByToken: jest.fn().mockResolvedValue(undefined),
    registerDynamicClient: jest.fn().mockResolvedValue({
      client_id: 'dyn-client-001',
      client_id_issued_at: 1717000000,
      client_name: 'Claude Desktop',
      redirect_uris: ['http://127.0.0.1:29352/callback'],
      token_endpoint_auth_method: 'none' as const,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  };
}

/**
 * Creates a minimal mock Express Response with jest spies for status(), json(),
 * send(), and setHeader(). The status() spy returns `this` so chains work.
 */
function makeMockRes(): jest.Mocked<Response> {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as jest.Mocked<Response>;

  // Allow chaining: res.status(200).json(...)
  res.status.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);
  return res;
}

/**
 * Creates a minimal mock Express Request with an arbitrary body.
 */
function makeMockReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('OAuthController', () => {
  let controller: OAuthController;
  let oauthService: ReturnType<typeof makeMockOAuthService>;

  beforeEach(async () => {
    oauthService = makeMockOAuthService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        {
          provide: OAuthService,
          useValue: oauthService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'OAUTH_ISSUER_URL') return ISSUER;
              return undefined;
            }),
            getOrThrow: jest.fn((key: string) => {
              if (key === 'OAUTH_ISSUER_URL') return ISSUER;
              throw new Error(`Config key not found: ${key}`);
            }),
          },
        },
      ],
    })
      // Route-level guard on POST /oauth/register: stub it permissively so
      // the controller instantiates cleanly without needing the real
      // ThrottlerService DI tree.
      .overrideGuard(McpIpThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OAuthController);
  });

  // =========================================================================
  // POST /oauth/token
  // =========================================================================

  describe('POST /oauth/token', () => {
    // -----------------------------------------------------------------------
    // grant_type=authorization_code
    // -----------------------------------------------------------------------

    describe('grant_type=authorization_code', () => {
      it('happy path: calls exchangeCode and returns RFC 6749 §5.1 shape', async () => {
        const req = makeMockReq({
          grant_type: 'authorization_code',
          code: 'auth-code-abc',
          code_verifier: 'verifier-abc',
          client_id: 'claude-desktop',
          redirect_uri: 'https://claude.ai/oauth/callback',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(oauthService.exchangeCode).toHaveBeenCalledWith({
          code: 'auth-code-abc',
          codeVerifier: 'verifier-abc',
          clientId: 'claude-desktop',
          redirectUri: 'https://claude.ai/oauth/callback',
        });

        expect(res.status).toHaveBeenCalledWith(200);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg).toMatchObject({
          access_token: TOKEN_RESULT.accessToken,
          token_type: 'Bearer',
          refresh_token: TOKEN_RESULT.refreshToken,
          scope: 'daubert:agent',
        });
        expect(typeof jsonArg.expires_in).toBe('number');
        expect(jsonArg.expires_in as number).toBeGreaterThan(0);
      });

      it('sets Cache-Control: no-store on successful response', async () => {
        const req = makeMockReq({
          grant_type: 'authorization_code',
          code: 'auth-code-abc',
          code_verifier: 'verifier-abc',
          client_id: 'claude-desktop',
          redirect_uri: 'https://claude.ai/oauth/callback',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      });

      it('missing code → 400 invalid_request', async () => {
        const req = makeMockReq({
          grant_type: 'authorization_code',
          // code missing
          code_verifier: 'verifier',
          client_id: 'claude-desktop',
          redirect_uri: 'https://claude.ai/oauth/callback',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg.error).toBe('invalid_request');
        expect(typeof jsonArg.error_description).toBe('string');
      });

      it('missing code_verifier → 400 invalid_request', async () => {
        const req = makeMockReq({
          grant_type: 'authorization_code',
          code: 'code',
          // code_verifier missing
          client_id: 'claude-desktop',
          redirect_uri: 'https://claude.ai/oauth/callback',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg.error).toBe('invalid_request');
      });

      it('OAuthInvalidGrantError from service → 400 invalid_grant', async () => {
        oauthService.exchangeCode.mockRejectedValue(
          new OAuthInvalidGrantError('PKCE code_verifier is invalid.'),
        );

        const req = makeMockReq({
          grant_type: 'authorization_code',
          code: 'code',
          code_verifier: 'wrong',
          client_id: 'claude-desktop',
          redirect_uri: 'https://claude.ai/oauth/callback',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg.error).toBe('invalid_grant');
        expect(typeof jsonArg.error_description).toBe('string');
      });
    });

    // -----------------------------------------------------------------------
    // grant_type=refresh_token
    // -----------------------------------------------------------------------

    describe('grant_type=refresh_token', () => {
      it('happy path: calls exchangeRefreshToken and returns RFC 6749 §5.1 shape', async () => {
        const req = makeMockReq({
          grant_type: 'refresh_token',
          refresh_token: 'raw-refresh-abc',
          client_id: 'claude-desktop',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(oauthService.exchangeRefreshToken).toHaveBeenCalledWith({
          refreshToken: 'raw-refresh-abc',
          clientId: 'claude-desktop',
        });

        expect(res.status).toHaveBeenCalledWith(200);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg).toMatchObject({
          access_token: TOKEN_RESULT.accessToken,
          token_type: 'Bearer',
          refresh_token: TOKEN_RESULT.refreshToken,
          scope: 'daubert:agent',
        });
      });

      it('missing refresh_token → 400 invalid_request', async () => {
        const req = makeMockReq({
          grant_type: 'refresh_token',
          // refresh_token missing
          client_id: 'claude-desktop',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg.error).toBe('invalid_request');
      });

      it('missing client_id → 400 invalid_request', async () => {
        const req = makeMockReq({
          grant_type: 'refresh_token',
          refresh_token: 'token',
          // client_id missing
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg.error).toBe('invalid_request');
      });

      it('OAuthInvalidGrantError from service → 400 invalid_grant', async () => {
        oauthService.exchangeRefreshToken.mockRejectedValue(
          new OAuthInvalidGrantError('Refresh token not found.'),
        );

        const req = makeMockReq({
          grant_type: 'refresh_token',
          refresh_token: 'unknown',
          client_id: 'claude-desktop',
        });
        const res = makeMockRes();

        await controller.token(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
        expect(jsonArg.error).toBe('invalid_grant');
      });
    });

    // -----------------------------------------------------------------------
    // Unknown / missing grant_type
    // -----------------------------------------------------------------------

    it('unknown grant_type → 400 unsupported_grant_type', async () => {
      const req = makeMockReq({ grant_type: 'client_credentials' });
      const res = makeMockRes();

      await controller.token(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.error).toBe('unsupported_grant_type');
    });

    it('missing grant_type → 400 invalid_request', async () => {
      const req = makeMockReq({});
      const res = makeMockRes();

      await controller.token(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      const jsonArg = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(jsonArg.error).toBe('invalid_request');
    });
  });

  // =========================================================================
  // POST /oauth/revoke
  // =========================================================================

  describe('POST /oauth/revoke', () => {
    it('happy path: calls revokeByToken and returns 200 empty body', async () => {
      const req = makeMockReq({
        token: 'raw-access-abc',
        client_id: 'claude-desktop',
      });
      const res = makeMockRes();

      await controller.revoke(req, res);

      expect(oauthService.revokeByToken).toHaveBeenCalledWith(
        'raw-access-abc',
        'claude-desktop',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('unknown token → 200 empty (no leak, RFC 7009 §2.2)', async () => {
      oauthService.revokeByToken.mockResolvedValue(undefined);

      const req = makeMockReq({
        token: 'no-such-token',
        client_id: 'claude-desktop',
      });
      const res = makeMockRes();

      await controller.revoke(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('service throws unexpectedly → still returns 200 (RFC 7009 §2.2)', async () => {
      oauthService.revokeByToken.mockRejectedValue(new Error('DB error'));

      const req = makeMockReq({
        token: 'token',
        client_id: 'claude-desktop',
      });
      const res = makeMockRes();

      await controller.revoke(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('');
    });

    it('missing token → 200 (no-op, no enumeration)', async () => {
      const req = makeMockReq({ client_id: 'claude-desktop' });
      const res = makeMockRes();

      await controller.revoke(req, res);

      // No revokeByToken call — skipped when token is missing.
      expect(oauthService.revokeByToken).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith('');
    });
  });

  // =========================================================================
  // POST /oauth/register — RFC 7591 Dynamic Client Registration
  // =========================================================================

  describe('POST /oauth/register', () => {
    it('happy path: delegates to OAuthService and returns the RFC 7591 response', async () => {
      const req = makeMockReq({
        client_name: 'Claude Desktop',
        redirect_uris: ['http://127.0.0.1:29352/callback'],
      });
      const result = await controller.register(req);

      expect(oauthService.registerDynamicClient).toHaveBeenCalledWith({
        client_name: 'Claude Desktop',
        redirect_uris: ['http://127.0.0.1:29352/callback'],
        token_endpoint_auth_method: undefined,
        grant_types: undefined,
        response_types: undefined,
        scope: undefined,
      });
      expect(result.client_id).toBe('dyn-client-001');
      expect(result.token_endpoint_auth_method).toBe('none');
      // No client_secret in public PKCE-only mode.
      expect(result).not.toHaveProperty('client_secret');
    });

    it('passes through all RFC 7591 optional fields when provided', async () => {
      const req = makeMockReq({
        client_name: 'My App',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: 'daubert:agent',
      });
      await controller.register(req);

      expect(oauthService.registerDynamicClient).toHaveBeenCalledWith({
        client_name: 'My App',
        redirect_uris: ['https://example.com/cb'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: 'daubert:agent',
      });
    });

    it('coerces non-array redirect_uris to [] (service will reject)', async () => {
      oauthService.registerDynamicClient.mockRejectedValueOnce(
        new BadRequestException({
          error: 'invalid_redirect_uri',
          error_description: 'redirect_uris is required and must be non-empty.',
        }),
      );
      const req = makeMockReq({ redirect_uris: 'not-an-array' });

      await expect(controller.register(req)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // GET /.well-known/oauth-authorization-server
  // =========================================================================

  describe('GET /.well-known/oauth-authorization-server', () => {
    it('returns correct issuer and endpoint URLs', () => {
      const result = controller.authorizationServerMetadata();

      expect(result.issuer).toBe(ISSUER);
      expect(result.authorization_endpoint).toBe(`${ISSUER}/oauth/authorize`);
      expect(result.token_endpoint).toBe(`${ISSUER}/oauth/token`);
      expect(result.revocation_endpoint).toBe(`${ISSUER}/oauth/revoke`);
      expect(result.registration_endpoint).toBe(`${ISSUER}/oauth/register`);
    });

    it('includes required OAuth 2.1 metadata fields', () => {
      const result = controller.authorizationServerMetadata();

      expect(result.response_types_supported).toEqual(['code']);
      expect(result.grant_types_supported).toEqual([
        'authorization_code',
        'refresh_token',
      ]);
      expect(result.code_challenge_methods_supported).toEqual(['S256']);
      expect(result.token_endpoint_auth_methods_supported).toEqual(['none']);
      expect(result.scopes_supported).toEqual(['daubert:agent']);
    });
  });

  // =========================================================================
  // GET /.well-known/oauth-protected-resource
  // =========================================================================

  describe('GET /.well-known/oauth-protected-resource', () => {
    it('returns correct resource and authorization_servers', () => {
      const result = controller.protectedResourceMetadata();

      expect(result.resource).toBe(`${ISSUER}/mcp`);
      expect(result.authorization_servers).toEqual([ISSUER]);
    });

    it('includes bearer_methods_supported and scopes_supported', () => {
      const result = controller.protectedResourceMetadata();

      expect(result.bearer_methods_supported).toEqual(['header']);
      expect(result.scopes_supported).toEqual(['daubert:agent']);
    });
  });
});
