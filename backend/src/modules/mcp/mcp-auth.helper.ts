/**
 * McpAuthHelper — extracts and validates an OAuth bearer credential from an
 * MCP HTTP request and enforces per-call eligibility.
 *
 * Ported from belong-mc's `McpAuthHelper`, simplified to OAuth-only — Daubert
 * V1 has no API-key path. Every MCP HTTP request runs through `authenticate()`
 * exactly once at the controller body. Tool handlers receive the resolved
 * `AuthResult` via closure (no `req.mcpAuth` cache).
 *
 * Flow:
 *   1. Parse `Authorization: Bearer <token>`. Absent or malformed → `oauth-401`
 *      with `error="invalid_token"`. OAuth-aware clients treat this as the
 *      discovery trigger (RFC 9728) and walk the resource_metadata URL.
 *   2. `OAuthService.validateAccessToken(token)` — null on hash miss, expiry,
 *      or revocation. Null → `oauth-401`.
 *   3. **Per-call eligibility (security criterion #2).** Re-load the owner's
 *      `organization_members` row for the session's `(ownerUserId,
 *      organizationId)`. Absent or `role === 'guest'` → `oauth-401`
 *      `error_description="membership_revoked"`. This is what makes a
 *      post-consent removal or downgrade take effect immediately — the refresh
 *      grant carries the same check in `OAuthService.exchangeRefreshToken`,
 *      but per-call is what closes the gap inside the access-token TTL.
 *   4. Per-session throttle: 60 hits / 60 s on `oauth_session:<sessionId>`.
 *      Breach → `oauth-401` `error_description="rate_limited"`.
 *   5. Success → `{ kind: 'oauth', user, session, principal }` where the
 *      principal is the canonical Daubert `AccessPrincipal` for MCP requests.
 *
 * `validateAccessToken` already loads `session.owner` so we surface it
 * directly — no second roundtrip to `users`.
 *
 * The OAuth `WWW-Authenticate` header always uses `error="invalid_token"` —
 * the canonical OAuth-spec error for an auth failure on a protected resource.
 * `error_description` disambiguates between the soft failure modes
 * (`membership_revoked`, `rate_limited`).
 */

import type { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OAuthSessionEntity } from '../../database/entities/oauth-session.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { McpThrottleService } from '../../common/throttle/mcp-throttle';
import { OAuthService } from '../oauth/oauth.service';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Successful authentication result. `principal` is the canonical Daubert
 * `AccessPrincipal` shape stamped onto `req.principal` by the MCP controller
 * before tool dispatch, so downstream service code reads MCP requests the
 * same way it reads any other authenticated request.
 */
export interface AuthSuccess {
  kind: 'oauth';
  user: UserEntity;
  session: OAuthSessionEntity;
  principal: {
    kind: 'mcp';
    userId: string;
    organizationId: string;
    sessionId: string;
  };
}

/**
 * Auth failure. The controller writes HTTP 401 with the `WWW-Authenticate`
 * header verbatim — OAuth-aware MCP clients (Claude Desktop, Claude Code,
 * claude.ai) use the embedded `resource_metadata` URL to walk the discovery
 * flow per RFC 9728.
 */
export interface AuthFailure {
  kind: 'oauth-401';
  wwwAuthenticate: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Narrows `AuthResult` to its success variant so callers can proceed to tool
 * dispatch without re-checking the discriminator.
 */
export function isAuthSuccess(result: AuthResult): result is AuthSuccess {
  return result.kind === 'oauth';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class McpAuthHelper {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly throttle: McpThrottleService,
    @InjectRepository(OrganizationMemberEntity)
    private readonly memberRepo: Repository<OrganizationMemberEntity>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Authenticate an MCP request. Returns either an `AuthSuccess` (with the
   * resolved user/session/principal) or an `AuthFailure` (with the
   * `WWW-Authenticate` header the controller should write back).
   */
  async authenticate(req: Request): Promise<AuthResult> {
    // ---------------------------------------------------------------------
    // 1. Parse bearer token.
    // ---------------------------------------------------------------------
    const token = this.extractBearerToken(req);
    if (!token) {
      return {
        kind: 'oauth-401',
        wwwAuthenticate: this.buildWwwAuthenticate('invalid_token'),
      };
    }

    // ---------------------------------------------------------------------
    // 2. Validate the access token (hash lookup + expiry + revocation).
    // ---------------------------------------------------------------------
    const session = await this.oauthService.validateAccessToken(token);
    if (!session) {
      return {
        kind: 'oauth-401',
        wwwAuthenticate: this.buildWwwAuthenticate('invalid_token'),
      };
    }

    // ---------------------------------------------------------------------
    // 3. Per-call eligibility — security criterion #2.
    //
    // Re-load the owner's membership row in the bound org on every call. If
    // an admin removed the user or downgraded them to guest after consent,
    // we reject *now* rather than waiting for the next refresh exchange.
    // ---------------------------------------------------------------------
    const membership = await this.memberRepo.findOne({
      where: {
        userId: session.ownerUserId,
        organizationId: session.organizationId,
      },
    });
    if (!membership || membership.role === 'guest') {
      return {
        kind: 'oauth-401',
        wwwAuthenticate: this.buildWwwAuthenticate(
          'invalid_token',
          'membership_revoked',
        ),
      };
    }

    // ---------------------------------------------------------------------
    // 4. Per-session throttle (60 hits / 60 s).
    //
    // Charged AFTER eligibility so a revoked/guest user does not accumulate
    // hits on a bucket they no longer own.
    // ---------------------------------------------------------------------
    const throttleResult = this.throttle.hit(
      `oauth_session:${session.id}`,
      60,
      60,
    );
    if (!throttleResult.allowed) {
      return {
        kind: 'oauth-401',
        wwwAuthenticate: this.buildWwwAuthenticate(
          'invalid_token',
          'rate_limited',
        ),
      };
    }

    // ---------------------------------------------------------------------
    // 5. Success.
    // ---------------------------------------------------------------------
    return {
      kind: 'oauth',
      user: session.owner,
      session,
      principal: {
        kind: 'mcp',
        userId: session.ownerUserId,
        organizationId: session.organizationId,
        sessionId: session.id,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract the bearer token from `Authorization: Bearer <token>`. Returns
   * `undefined` for any malformed shape — array-valued headers (which Node
   * surfaces for repeated `Authorization` headers) are explicitly rejected
   * rather than silently picking the first entry.
   */
  private extractBearerToken(req: Request): string | undefined {
    const raw = req.headers?.authorization;
    if (!raw || typeof raw !== 'string') return undefined;
    const [scheme, token, ...rest] = raw.split(' ');
    if (scheme !== 'Bearer' || !token || rest.length > 0) return undefined;
    return token;
  }

  /**
   * Build the RFC 9728 `WWW-Authenticate` header value pointing OAuth-aware
   * clients at the protected-resource metadata document. Format matches
   * belong-mc:
   *
   *   Bearer realm="daubert", error="<code>",
   *   resource_metadata="<issuer>/.well-known/oauth-protected-resource"
   *   [, error_description="<description>"]
   */
  private buildWwwAuthenticate(error: string, description?: string): string {
    const issuer = this.config.getOrThrow<string>('OAUTH_ISSUER_URL');
    const base = `Bearer realm="daubert", error="${error}", resource_metadata="${issuer}/.well-known/oauth-protected-resource"`;
    return description ? `${base}, error_description="${description}"` : base;
  }
}
