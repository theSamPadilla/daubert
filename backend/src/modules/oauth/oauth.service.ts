import { createHash, randomBytes } from 'crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, Repository } from 'typeorm';

import { OAuthClientEntity } from '../../database/entities/oauth-client.entity';
import { OAuthCodeEntity } from '../../database/entities/oauth-code.entity';
import { OAuthConsumedStateEntity } from '../../database/entities/oauth-consumed-state.entity';
import {
  OAuthSessionEntity,
  OAuthSessionRevokedReason,
} from '../../database/entities/oauth-session.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssueCodeParams {
  ownerUserId: string;
  clientId: string;
  /**
   * Daubert adaptation: codes (and the sessions they create) are scoped to a
   * single (owner, organization) pair. There is no coarse `scope` enum; the
   * user's effective permissions are derived live from their org/case
   * membership at tool-call time.
   */
  organizationId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  state?: string | null;
}

export interface ExchangeCodeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  organizationId: string;
  oauthSessionId: string;
}

export interface ExchangeRefreshParams {
  refreshToken: string;
  clientId: string;
}

/** Standard OAuth error thrown for `invalid_grant` conditions. */
export class OAuthInvalidGrantError extends BadRequestException {
  constructor(description: string) {
    super({ error: 'invalid_grant', error_description: description });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex of an arbitrary string. */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** base64url-encoded SHA-256 of a string (used for PKCE S256 verification). */
function sha256Base64url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** Generate a 32-byte random token, base64url-encoded (~43 chars). */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Accepts a redirect URI for RFC 7591 Dynamic Client Registration if it is:
 *   - `https://...` — any host (Claude.ai web callbacks)
 *   - `http://127.0.0.1[:port]/...` or `http://[::1][:port]/...` — loopback
 *     per RFC 8252 for native apps (Claude Code, Claude Desktop loopback)
 *   - A custom scheme like `claude://...` (Claude Desktop deep-link)
 *
 * Rejects plain non-loopback `http://example.com` because that would allow a
 * malicious DCR caller to register a credential-stealing redirect target.
 * PKCE prevents code-stealing but not phishing-via-consent-redirect.
 */
function isAcceptableRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') {
    // Loopback only.
    const host = parsed.hostname;
    return host === '127.0.0.1' || host === '[::1]' || host === '::1';
  }
  // Custom schemes (e.g. `claude://oauth/callback`) — accepted; the consent
  // screen displays the redirect URI so users can spot anomalous targets.
  // Disallow `javascript:`, `data:`, `file:` and other obviously dangerous
  // schemes via an explicit blocklist.
  const banned = new Set([
    'javascript:',
    'data:',
    'file:',
    'vbscript:',
    'about:',
  ]);
  return !banned.has(parsed.protocol);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  /** Access token TTL in seconds. Default 3600. */
  private readonly accessTokenTtlSeconds: number;

  /** Refresh token TTL in days. Default 30. Sliding — reset on every exchange. */
  private readonly refreshTokenTtlDays: number;

  /** Authorization code TTL in seconds. Default 60. */
  private readonly codeTtlSeconds: number;

  constructor(
    @InjectRepository(OAuthCodeEntity)
    private readonly codeRepo: Repository<OAuthCodeEntity>,
    @InjectRepository(OAuthSessionEntity)
    private readonly sessionRepo: Repository<OAuthSessionEntity>,
    @InjectRepository(OAuthClientEntity)
    private readonly clientRepo: Repository<OAuthClientEntity>,
    @InjectRepository(OAuthConsumedStateEntity)
    private readonly consumedStateRepo: Repository<OAuthConsumedStateEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly memberRepo: Repository<OrganizationMemberEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.accessTokenTtlSeconds = this.config.get<number>(
      'OAUTH_ACCESS_TOKEN_TTL_S',
      3600,
    );
    this.refreshTokenTtlDays = this.config.get<number>(
      'OAUTH_REFRESH_TOKEN_TTL_DAYS',
      30,
    );
    this.codeTtlSeconds = this.config.get<number>('OAUTH_CODE_TTL_S', 60);
  }

  // -------------------------------------------------------------------------
  // registerDynamicClient — RFC 7591 Dynamic Client Registration
  // -------------------------------------------------------------------------

  /**
   * Registers a new public OAuth client per RFC 7591. Claude Desktop,
   * claude.ai, and Claude Code call this on first connect after discovering
   * the `registration_endpoint` via RFC 8414 metadata.
   *
   * V1 constraints:
   *   - Public clients only (PKCE-only). Any non-`none`
   *     `token_endpoint_auth_method` is rejected.
   *   - `redirect_uris` is required and must be a non-empty array. Each URI
   *     must be `http://127.0.0.1[:port]/...`, `http://[::1][:port]/...`,
   *     `https://...`, or a custom scheme. Plain non-loopback `http://` is
   *     rejected; `javascript:`, `data:`, `file:`, etc. are rejected.
   *   - `grant_types` defaults to `['authorization_code', 'refresh_token']`;
   *     other values rejected.
   *   - `response_types` defaults to `['code']`; other values rejected.
   *
   * Returns the RFC 7591 client_information_response. No `client_secret`
   * because public clients use PKCE.
   */
  async registerDynamicClient(req: {
    client_name?: string;
    redirect_uris: string[];
    token_endpoint_auth_method?: string;
    grant_types?: string[];
    response_types?: string[];
    scope?: string;
  }): Promise<{
    client_id: string;
    client_id_issued_at: number;
    client_name: string;
    redirect_uris: string[];
    token_endpoint_auth_method: 'none';
    grant_types: string[];
    response_types: string[];
  }> {
    // ----- validate request --------------------------------------------------
    if (!Array.isArray(req.redirect_uris) || req.redirect_uris.length === 0) {
      throw new BadRequestException({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must be non-empty.',
      });
    }
    for (const uri of req.redirect_uris) {
      if (typeof uri !== 'string' || !isAcceptableRedirectUri(uri)) {
        throw new BadRequestException({
          error: 'invalid_redirect_uri',
          error_description: `redirect_uri "${uri}" is not a permitted form (must be https, loopback http, or a custom scheme).`,
        });
      }
    }

    const authMethod = req.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none') {
      throw new BadRequestException({
        error: 'invalid_client_metadata',
        error_description:
          'Only token_endpoint_auth_method="none" is supported (public clients with PKCE).',
      });
    }

    const grantTypes = req.grant_types ?? [
      'authorization_code',
      'refresh_token',
    ];
    const allowedGrants = new Set(['authorization_code', 'refresh_token']);
    for (const g of grantTypes) {
      if (!allowedGrants.has(g)) {
        throw new BadRequestException({
          error: 'invalid_client_metadata',
          error_description: `grant_type "${g}" is not supported.`,
        });
      }
    }

    const responseTypes = req.response_types ?? ['code'];
    if (responseTypes.length !== 1 || responseTypes[0] !== 'code') {
      throw new BadRequestException({
        error: 'invalid_client_metadata',
        error_description:
          'Only response_type="code" is supported (authorization code flow).',
      });
    }

    // ----- mint and persist --------------------------------------------------
    // 32 random bytes base64url-encoded ≈ 43 chars. Fits in varchar(64).
    const clientId = generateToken();
    const clientName =
      typeof req.client_name === 'string' && req.client_name.trim().length > 0
        ? req.client_name.trim().slice(0, 128)
        : 'Unnamed MCP client';

    const row = this.clientRepo.create({
      clientId,
      displayName: clientName,
      redirectUris: req.redirect_uris,
      isPublicClient: true,
      isDynamic: true,
    });
    await this.clientRepo.save(row);

    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: req.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: grantTypes,
      response_types: responseTypes,
    };
  }

  // -------------------------------------------------------------------------
  // issueCode
  // -------------------------------------------------------------------------

  /**
   * Issues a short-lived single-use authorization code.
   *
   * Only S256 PKCE is accepted; plain PKCE and no-PKCE are rejected.
   *
   * Daubert adaptation: codes carry `organizationId`, not a coarse scope.
   *
   * @returns The raw authorization code (base64url, ~43 chars).
   */
  async issueCode(params: IssueCodeParams): Promise<string> {
    const {
      ownerUserId,
      clientId,
      organizationId,
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      state = null,
    } = params;

    if (codeChallengeMethod !== 'S256') {
      throw new BadRequestException(
        'Only S256 code_challenge_method is supported.',
      );
    }

    const rawCode = generateToken();
    const expiresAt = new Date(Date.now() + this.codeTtlSeconds * 1000);

    // Store the SHA-256 hex of the code as the PK; the raw code is only ever
    // returned to the caller and never persisted. Parallels the hash-at-rest
    // posture for access/refresh tokens. The short TTL alone is a narrow
    // defense; this closes the consistency gap.
    const row = this.codeRepo.create({
      code: sha256Hex(rawCode),
      ownerUserId,
      organizationId,
      clientId,
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      state: state ?? null,
      expiresAt,
      consumedAt: null,
    });

    await this.codeRepo.save(row);

    return rawCode;
  }

  // -------------------------------------------------------------------------
  // exchangeCode
  // -------------------------------------------------------------------------

  /**
   * Exchanges an authorization code for access + refresh tokens.
   *
   * PKCE S256 is verified here: `base64url(sha256(codeVerifier))` must match
   * the stored `codeChallenge`. The code row is atomically marked consumed in
   * the same operation as the session insert.
   *
   * Tokens are opaque random bytes; only SHA-256 hashes are stored at rest.
   * The raw tokens are returned once and never re-readable.
   */
  async exchangeCode(params: ExchangeCodeParams): Promise<TokenResult> {
    const { code, codeVerifier, clientId, redirectUri } = params;

    // 1. Look up the code row by SHA-256 hex of the presented code. The PK is
    //    the hash; the raw value was only ever returned to the
    //    `/authorize/complete` caller. Hash mismatch and "not found" surface
    //    the same error to avoid leaking which condition failed.
    const codeRow = await this.codeRepo.findOne({
      where: { code: sha256Hex(code) },
    });

    if (!codeRow) {
      throw new OAuthInvalidGrantError('Authorization code not found.');
    }

    // 2. Single-use check.
    if (codeRow.consumedAt !== null) {
      throw new OAuthInvalidGrantError(
        'Authorization code has already been used.',
      );
    }

    // 3. Expiry check.
    if (codeRow.expiresAt < new Date()) {
      throw new OAuthInvalidGrantError('Authorization code has expired.');
    }

    // 4. Client and redirect_uri binding.
    if (codeRow.clientId !== clientId) {
      throw new OAuthInvalidGrantError(
        'client_id does not match the authorization code.',
      );
    }
    if (codeRow.redirectUri !== redirectUri) {
      throw new OAuthInvalidGrantError(
        'redirect_uri does not match the authorization code.',
      );
    }

    // 5. PKCE S256 verification.
    const expectedChallenge = sha256Base64url(codeVerifier);
    if (expectedChallenge !== codeRow.codeChallenge) {
      throw new OAuthInvalidGrantError('PKCE code_verifier is invalid.');
    }

    // 6. Look up the client to get the display name for surfaceLabel.
    const client = await this.clientRepo.findOne({
      where: { clientId },
    });
    const surfaceLabel = client?.displayName ?? clientId;

    // 7. Generate tokens.
    const rawAccessToken = generateToken();
    const rawRefreshToken = generateToken();
    const accessTokenHash = sha256Hex(rawAccessToken);
    const refreshTokenHash = sha256Hex(rawRefreshToken);

    const now = new Date();
    const accessTokenExpiresAt = new Date(
      now.getTime() + this.accessTokenTtlSeconds * 1000,
    );
    const refreshTokenExpiresAt = new Date(
      now.getTime() + this.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    // 8. Atomically (one transaction): mark code consumed + insert session.
    //    The conditional UPDATE (WHERE consumed_at IS NULL) + affected-rows
    //    check is what prevents the concurrent-exchange race: if two requests
    //    arrive with the same code, exactly one update sees `affected = 1` and
    //    proceeds to insert the session; the loser sees `affected = 0` and
    //    aborts with invalid_grant without ever inserting a duplicate session.
    const session = await this.dataSource.transaction(async (manager) => {
      const updateResult = await manager.update(
        OAuthCodeEntity,
        { code: codeRow.code, consumedAt: IsNull() },
        { consumedAt: now },
      );

      if (updateResult.affected === 0) {
        throw new OAuthInvalidGrantError(
          'Authorization code has already been used.',
        );
      }

      const sessionRow = manager.create(OAuthSessionEntity, {
        ownerUserId: codeRow.ownerUserId,
        organizationId: codeRow.organizationId,
        clientId: codeRow.clientId,
        surfaceLabel,
        accessTokenHash,
        refreshTokenHash,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        lastUsedAt: null,
        revokedAt: null,
        revokedReason: null,
      });

      return manager.save(OAuthSessionEntity, sessionRow);
    });

    return {
      accessToken: rawAccessToken,
      refreshToken: rawRefreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      organizationId: codeRow.organizationId,
      oauthSessionId: session.id,
    };
  }

  // -------------------------------------------------------------------------
  // exchangeRefreshToken
  // -------------------------------------------------------------------------

  /**
   * Rotates the refresh token for an existing session.
   *
   * **Refresh-rotation V1 trade-off:**
   * Only the *current* refresh token hash is stored on the session row. If a
   * caller presents an old (rotated-out) refresh token, the hash lookup
   * returns no matching session, and we cannot attribute that to a specific
   * session for chain-revocation — there is no session to revoke. Reuse
   * detection therefore fires only in the case where the session row IS found
   * but is *already revoked* (i.e., another path already revoked it after a
   * detected reuse).
   *
   * **Daubert refresh-time eligibility re-check:**
   * On every refresh, we re-load the owner's `organization_members` row for
   * the session's `organization_id`. If that row is absent or has
   * `role === 'guest'`, the entire session chain is revoked with
   * `'membership_revoked'` and `invalid_grant` is returned. This is the
   * refresh-time half of the per-call eligibility gate — the per-call half
   * lives in `McpAuthHelper` (Task 10).
   */
  async exchangeRefreshToken(
    params: ExchangeRefreshParams,
  ): Promise<TokenResult> {
    const { refreshToken, clientId } = params;

    // 1. Look up session by refresh token hash.
    const refreshHash = sha256Hex(refreshToken);
    const session = await this.sessionRepo.findOne({
      where: { refreshTokenHash: refreshHash },
      relations: { owner: true },
    });

    if (!session) {
      // Unknown hash — rotated-out token (V1 limitation) or garbage. Nothing
      // to revoke; return invalid_grant.
      throw new OAuthInvalidGrantError('Refresh token not found.');
    }

    // 2. Client binding check.
    if (session.clientId !== clientId) {
      throw new OAuthInvalidGrantError(
        'client_id does not match the refresh token session.',
      );
    }

    // 3. Reuse detection — session already revoked.
    if (session.revokedAt !== null) {
      // Chain revocation: revoke all live sessions for this owner.
      await this.revokeAllSessionsForOwner(
        session.ownerUserId,
        'refresh_reuse',
      );
      throw new OAuthInvalidGrantError(
        'Refresh token reuse detected; all sessions have been revoked.',
      );
    }

    // 4. Natural expiry — do NOT revoke; just reject.
    if (session.refreshTokenExpiresAt < new Date()) {
      throw new OAuthInvalidGrantError('Refresh token has expired.');
    }

    // 5. Daubert eligibility re-check at refresh time. Re-load the owner's
    //    organization_members row for the session's org. Absent or guest →
    //    revoke chain + invalid_grant.
    const membership = await this.memberRepo.findOne({
      where: {
        userId: session.ownerUserId,
        organizationId: session.organizationId,
      },
    });
    if (!membership || membership.role === 'guest') {
      await this.revokeAllSessionsForOwner(
        session.ownerUserId,
        'membership_revoked',
      );
      throw new OAuthInvalidGrantError(
        'User is no longer a member of the session organization; all sessions have been revoked.',
      );
    }

    // 6. Rotate: generate new tokens, update session.
    const rawAccessToken = generateToken();
    const rawRefreshToken = generateToken();
    const newAccessTokenHash = sha256Hex(rawAccessToken);
    const newRefreshTokenHash = sha256Hex(rawRefreshToken);

    const now = new Date();
    const accessTokenExpiresAt = new Date(
      now.getTime() + this.accessTokenTtlSeconds * 1000,
    );
    // Sliding refresh TTL — reset on every successful exchange.
    const refreshTokenExpiresAt = new Date(
      now.getTime() + this.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.sessionRepo.update(
      { id: session.id },
      {
        accessTokenHash: newAccessTokenHash,
        refreshTokenHash: newRefreshTokenHash,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        lastUsedAt: now,
      },
    );

    return {
      accessToken: rawAccessToken,
      refreshToken: rawRefreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      organizationId: session.organizationId,
      oauthSessionId: session.id,
    };
  }

  // -------------------------------------------------------------------------
  // validateAccessToken
  // -------------------------------------------------------------------------

  /**
   * Validates an opaque access token and returns the OAuthSessionEntity (with
   * owner relation) on success, or null on any failure.
   *
   * Rejection reasons:
   *   - Hash miss (not found).
   *   - `accessTokenExpiresAt < now()`.
   *   - `revokedAt IS NOT NULL`.
   *
   * Daubert adaptation: no `users.active` check (no such column). Per-call
   * eligibility (membership, role) is enforced upstream in `McpAuthHelper`.
   *
   * `lastUsedAt` is updated fire-and-forget only when the existing value is
   * null or older than 60 seconds, to avoid hot-row churn.
   */
  async validateAccessToken(token: string): Promise<OAuthSessionEntity | null> {
    const hash = sha256Hex(token);

    const session = await this.sessionRepo.findOne({
      where: { accessTokenHash: hash },
      relations: { owner: true },
    });

    if (!session) return null;
    if (session.revokedAt !== null) return null;
    if (session.accessTokenExpiresAt < new Date()) return null;

    // Throttled `lastUsedAt` write.
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    if (session.lastUsedAt === null || session.lastUsedAt < sixtySecondsAgo) {
      // Fire-and-forget: do not await.
      this.sessionRepo
        .update(
          {
            id: session.id,
            lastUsedAt: session.lastUsedAt
              ? LessThan(sixtySecondsAgo)
              : IsNull(),
          },
          { lastUsedAt: new Date() },
        )
        .catch((err: unknown) => {
          this.logger.warn('Failed to update lastUsedAt on oauth_session', err);
        });
    }

    return session;
  }

  // -------------------------------------------------------------------------
  // revokeSession
  // -------------------------------------------------------------------------

  /**
   * Soft-revokes a single session by ID. Idempotent — if the session is
   * already revoked, this is a no-op.
   */
  async revokeSession(
    sessionId: string,
    reason: 'user' | 'admin',
  ): Promise<void> {
    await this.sessionRepo
      .createQueryBuilder()
      .update(OAuthSessionEntity)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where('id = :id AND revoked_at IS NULL', { id: sessionId })
      .execute();
  }

  // -------------------------------------------------------------------------
  // revokeAllSessionsForOwner
  // -------------------------------------------------------------------------

  /**
   * Revokes all live sessions for a given owner.
   *
   * Used for:
   *   - Refresh-reuse detection (`reason = 'refresh_reuse'`) — revokes all
   *     live sessions shared by the same owner. In V1, since sessions are
   *     per-device and there is no chain-lineage table, this revokes ALL
   *     live sessions for the owner (across all clients), not just the
   *     lineage of the reused token. This is intentionally conservative.
   *   - Membership revoked (`reason = 'membership_revoked'`) — the
   *     refresh-time half of the per-call eligibility gate.
   *   - Owner deactivation (`reason = 'owner_deactivated'`).
   *
   * @returns Count of sessions revoked (0 if none were live).
   */
  async revokeAllSessionsForOwner(
    ownerUserId: string,
    reason: OAuthSessionRevokedReason,
  ): Promise<number> {
    const result = await this.sessionRepo
      .createQueryBuilder()
      .update(OAuthSessionEntity)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where('owner_user_id = :ownerUserId AND revoked_at IS NULL', {
        ownerUserId,
      })
      .execute();

    return result.affected ?? 0;
  }

  // -------------------------------------------------------------------------
  // augmentSurfaceLabel
  // -------------------------------------------------------------------------

  /**
   * Conditional UPDATE: enrich the coarse `surfaceLabel` set at consent time
   * ("Claude Desktop") with details from the MCP `initialize` request
   * ("Claude Desktop 1.2 · macOS"). Fires only if the current row still has
   * the coarse value — once augmented, subsequent calls no-op.
   *
   * Idempotent + race-safe: the WHERE clause matches only when `surface_label`
   * equals the value the caller observed before issuing the UPDATE.
   *
   * Failure is non-fatal — callers should fire-and-forget.
   *
   * @returns true if the row was updated, false if no-op.
   */
  async augmentSurfaceLabel(
    sessionId: string,
    expectedCurrentLabel: string,
    augmentedLabel: string,
  ): Promise<boolean> {
    if (augmentedLabel === expectedCurrentLabel) return false;
    const result = await this.sessionRepo
      .createQueryBuilder()
      .update(OAuthSessionEntity)
      .set({ surfaceLabel: augmentedLabel })
      .where('id = :sessionId AND surface_label = :expectedCurrentLabel', {
        sessionId,
        expectedCurrentLabel,
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  // -------------------------------------------------------------------------
  // revokeByToken
  // -------------------------------------------------------------------------

  /**
   * Revokes the session matching a raw access OR refresh token.
   *
   * Used by `POST /oauth/revoke` (RFC 7009). The spec requires the endpoint
   * to always return HTTP 200 — even if the token is unknown or the client_id
   * does not match — to prevent token-existence enumeration. The caller
   * (controller) is responsible for swallowing errors; this method returns
   * silently on no-op.
   */
  async revokeByToken(token: string, clientId: string): Promise<void> {
    const hash = sha256Hex(token);

    // Try access-token hash first, then refresh-token hash.
    let session = await this.sessionRepo.findOne({
      where: { accessTokenHash: hash, revokedAt: IsNull() },
    });

    if (!session) {
      session = await this.sessionRepo.findOne({
        where: { refreshTokenHash: hash, revokedAt: IsNull() },
      });
    }

    if (!session) return; // unknown token — silent no-op per RFC 7009
    if (session.clientId !== clientId) return; // client_id mismatch — silent no-op

    await this.revokeSession(session.id, 'user');
  }

  // -------------------------------------------------------------------------
  // cleanupExpiredConsumedState
  // -------------------------------------------------------------------------

  /**
   * Deletes `oauth_consumed_state` rows where `expiresAt < now()`.
   *
   * These rows are the replay-protection cache for the signed state-bag.
   * They have a 10-minute TTL from consumption. This method removes expired
   * rows to keep the table lean.
   *
   * @returns Count of rows deleted.
   */
  async cleanupExpiredConsumedState(): Promise<number> {
    const result = await this.consumedStateRepo
      .createQueryBuilder()
      .delete()
      .from(OAuthConsumedStateEntity)
      .where('expires_at < :now', { now: new Date() })
      .execute();

    return result.affected ?? 0;
  }
}
