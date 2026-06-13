/**
 * OAuthController — OAuth 2.1 Authorization Server endpoints.
 *
 * Implements:
 *   - POST /oauth/token       — token endpoint (RFC 6749, RFC 7636 PKCE)
 *   - POST /oauth/revoke      — token revocation (RFC 7009)
 *   - POST /oauth/register    — RFC 7591 Dynamic Client Registration
 *   - GET  /.well-known/oauth-authorization-server  — AS metadata (RFC 8414)
 *   - GET  /.well-known/oauth-protected-resource    — PR metadata (RFC 9728)
 *
 * All routes are @Public() — the global AuthGuard (Firebase) skips them.
 * Requests to /oauth/token and /oauth/revoke use application/x-www-form-urlencoded
 * per the OAuth 2.1 spec. The urlencoded body parser is registered in main.ts.
 *
 * Daubert adaptations vs. belong-mc:
 *   - Config key is OAUTH_ISSUER_URL (not OAUTH_ISSUER).
 *   - TokenResult carries no `scope` field; all tokens get scope: 'daubert:agent'.
 *   - scopes_supported is ['daubert:agent'] across both discovery endpoints.
 *   - protected-resource `resource` is `${issuer}/mcp`.
 *
 * PKCE: enforced inside OAuthService.exchangeCode (S256-only).
 *
 * Error response shape per RFC 6749 §5.2:
 *   HTTP 400 + { error, error_description }
 */

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { McpIpThrottlerGuard } from '../../common/guards/mcp-ip-throttler.guard';
import { Public } from '../auth/public.decorator';
import { OAuthInvalidGrantError, OAuthService } from './oauth.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** RFC 6749 §5.1 successful token response. */
interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** RFC 6749 §5.2 error response. */
interface TokenErrorResponse {
  error: string;
  error_description: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller()
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // POST /oauth/token
  // -------------------------------------------------------------------------

  /**
   * OAuth 2.1 token endpoint.
   *
   * Accepts application/x-www-form-urlencoded (OAuth spec requirement).
   * NestJS does not auto-parse urlencoded bodies by default; `express.urlencoded`
   * is registered in main.ts.
   *
   * Supported grant_types:
   *   - authorization_code  (PKCE S256 required)
   *   - refresh_token
   *
   * Returns RFC 6749 §5.1 JSON on success, §5.2 JSON on error (HTTP 400).
   *
   * OAuthInvalidGrantError extends BadRequestException — we catch it here and
   * re-render as the RFC-mandated { error, error_description } shape before
   * NestJS's filter runs.
   */
  @Public()
  @Post('oauth/token')
  @HttpCode(200)
  async token(@Req() req: Request, @Res() res: Response): Promise<void> {
    // RFC 6749 §5.1: token endpoint responses must not be cached by
    // intermediaries — set this once so every code path inherits.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    const body = (req.body ?? {}) as Record<string, unknown>;

    const grantType =
      typeof body.grant_type === 'string' ? body.grant_type : undefined;

    if (!grantType) {
      this.sendTokenError(res, 'invalid_request', 'grant_type is required.');
      return;
    }

    try {
      if (grantType === 'authorization_code') {
        const result = await this.handleAuthorizationCode(body);
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(result);
      } else if (grantType === 'refresh_token') {
        const result = await this.handleRefreshToken(body);
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json(result);
      } else {
        this.sendTokenError(
          res,
          'unsupported_grant_type',
          `grant_type "${grantType}" is not supported.`,
        );
      }
    } catch (err: unknown) {
      if (err instanceof OAuthInvalidGrantError) {
        // Extract RFC 6749 §5.2 shape from the exception payload.
        const payload = err.getResponse() as {
          error?: string;
          error_description?: string;
        };
        this.sendTokenError(
          res,
          payload.error ?? 'invalid_grant',
          payload.error_description ?? err.message,
        );
      } else if (err instanceof BadRequestException) {
        this.sendTokenError(res, 'invalid_request', err.message);
      } else {
        throw err; // unexpected — let NestJS handle
      }
    }
  }

  // -------------------------------------------------------------------------
  // POST /oauth/revoke
  // -------------------------------------------------------------------------

  /**
   * Token revocation endpoint (RFC 7009).
   *
   * Accepts application/x-www-form-urlencoded.
   * Always returns HTTP 200 with an empty body — even if the token is unknown,
   * expired, or the client_id does not match. This prevents token-existence
   * enumeration per RFC 7009 §2.2.
   */
  @Public()
  @Post('oauth/revoke')
  @HttpCode(200)
  async revoke(@Req() req: Request, @Res() res: Response): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const token = typeof body.token === 'string' ? body.token : undefined;
    const clientId =
      typeof body.client_id === 'string' ? body.client_id : undefined;

    // RFC 7009 §2.2: respond 200 unconditionally to prevent enumeration.
    // We still attempt revocation if token + client_id are present.
    if (token && clientId) {
      try {
        await this.oauthService.revokeByToken(token, clientId);
      } catch {
        // Silently ignore — RFC 7009 always returns 200.
      }
    }

    res.status(200).send('');
  }

  // -------------------------------------------------------------------------
  // POST /oauth/register — RFC 7591 Dynamic Client Registration
  // -------------------------------------------------------------------------

  /**
   * Dynamic Client Registration endpoint.
   *
   * Accepts `application/json` (RFC 7591 §3.1). Returns RFC 7591 §3.2.1
   * client_information_response. No `client_secret` is issued — V1 only
   * accepts `token_endpoint_auth_method: "none"` (PKCE-only public clients).
   *
   * Throttled at the IP level by the route guard to bound spam-registration.
   */
  @Public()
  @UseGuards(McpIpThrottlerGuard)
  @Post('oauth/register')
  @HttpCode(201)
  async register(@Req() req: Request): Promise<Record<string, unknown>> {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const result = await this.oauthService.registerDynamicClient({
      client_name:
        typeof body.client_name === 'string' ? body.client_name : undefined,
      redirect_uris: Array.isArray(body.redirect_uris)
        ? (body.redirect_uris as string[])
        : [],
      token_endpoint_auth_method:
        typeof body.token_endpoint_auth_method === 'string'
          ? body.token_endpoint_auth_method
          : undefined,
      grant_types: Array.isArray(body.grant_types)
        ? (body.grant_types as string[])
        : undefined,
      response_types: Array.isArray(body.response_types)
        ? (body.response_types as string[])
        : undefined,
      scope: typeof body.scope === 'string' ? body.scope : undefined,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // GET /.well-known/oauth-authorization-server
  // -------------------------------------------------------------------------

  /**
   * OAuth 2.0 Authorization Server Metadata (RFC 8414).
   *
   * Returns the static metadata document describing this authorization server's
   * capabilities and endpoint locations. MCP clients use this for OAuth discovery.
   *
   * Daubert adaptation: scopes_supported is ['daubert:agent'].
   */
  @Public()
  @Get('.well-known/oauth-authorization-server')
  authorizationServerMetadata(): Record<string, unknown> {
    const issuer = this.config.getOrThrow<string>('OAUTH_ISSUER_URL');

    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['daubert:agent'],
      // Non-standard but widely-honored discovery hints for OAuth-aware
      // clients (e.g. Claude apps' Connectors panel) so they render the
      // white-background Daubert mark, not the dark-on-dark variant.
      service_documentation: issuer,
      op_policy_uri: issuer,
      op_tos_uri: issuer,
      logo_uri: `${issuer}/logo.png`,
    };
  }

  // -------------------------------------------------------------------------
  // GET /.well-known/oauth-protected-resource
  // -------------------------------------------------------------------------

  /**
   * OAuth 2.0 Protected Resource Metadata (RFC 9728).
   *
   * Describes the MCP endpoint as a protected resource. OAuth-aware MCP clients
   * read this to discover the authorization server and initiate the OAuth dance
   * after receiving a 401 from POST /mcp.
   *
   * Daubert adaptation:
   *   - resource is `${issuer}/mcp`
   *   - scopes_supported is ['daubert:agent']
   */
  @Public()
  @Get('.well-known/oauth-protected-resource')
  protectedResourceMetadata(): Record<string, unknown> {
    const issuer = this.config.getOrThrow<string>('OAUTH_ISSUER_URL');

    return {
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['daubert:agent'],
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Handles grant_type=authorization_code.
   * Validates required params and calls OAuthService.exchangeCode.
   */
  private async handleAuthorizationCode(
    body: Record<string, unknown>,
  ): Promise<TokenResponse> {
    const { code, code_verifier, client_id, redirect_uri } = body as {
      code?: string;
      code_verifier?: string;
      client_id?: string;
      redirect_uri?: string;
    };

    const missing: string[] = [];
    if (!code) missing.push('code');
    if (!code_verifier) missing.push('code_verifier');
    if (!client_id) missing.push('client_id');
    if (!redirect_uri) missing.push('redirect_uri');

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required parameters: ${missing.join(', ')}.`,
      );
    }

    const result = await this.oauthService.exchangeCode({
      code: code!,
      codeVerifier: code_verifier!,
      clientId: client_id!,
      redirectUri: redirect_uri!,
    });

    return this.buildTokenResponse(result);
  }

  /**
   * Handles grant_type=refresh_token.
   * Validates required params and calls OAuthService.exchangeRefreshToken.
   */
  private async handleRefreshToken(
    body: Record<string, unknown>,
  ): Promise<TokenResponse> {
    const { refresh_token, client_id } = body as {
      refresh_token?: string;
      client_id?: string;
    };

    const missing: string[] = [];
    if (!refresh_token) missing.push('refresh_token');
    if (!client_id) missing.push('client_id');

    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required parameters: ${missing.join(', ')}.`,
      );
    }

    const result = await this.oauthService.exchangeRefreshToken({
      refreshToken: refresh_token!,
      clientId: client_id!,
    });

    return this.buildTokenResponse(result);
  }

  /**
   * Maps a TokenResult to the RFC 6749 §5.1 wire shape.
   *
   * Daubert adaptation: TokenResult carries no `scope` field. All tokens are
   * issued with scope: 'daubert:agent'.
   */
  private buildTokenResponse(result: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: Date;
  }): TokenResponse {
    const expiresIn = Math.max(
      0,
      Math.floor((result.accessTokenExpiresAt.getTime() - Date.now()) / 1000),
    );

    return {
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: result.refreshToken,
      scope: 'daubert:agent',
    };
  }

  /** Writes a RFC 6749 §5.2 error response (HTTP 400). */
  private sendTokenError(
    res: Response,
    error: string,
    errorDescription: string,
  ): void {
    const body: TokenErrorResponse = {
      error,
      error_description: errorDescription,
    };
    res.setHeader('Content-Type', 'application/json');
    res.status(400).json(body);
  }
}
