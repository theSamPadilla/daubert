/**
 * AuthorizeController — OAuth 2.1 Authorization Endpoint for Daubert MCP.
 *
 * Implements:
 *   - GET  /oauth/authorize          — Validates OAuth parameters, authenticates
 *                                      the caller via a manually-verified Firebase
 *                                      ID token, then redirects to the FE consent
 *                                      page with a signed state-bag.
 *   - POST /oauth/authorize/preview  — Peeks the bag and returns the caller's
 *                                      eligible orgs (admin/member memberships)
 *                                      for the consent screen's org picker.
 *   - POST /oauth/authorize/complete — Verifies + consumes the bag, asserts the
 *                                      caller is admin/member of the chosen org
 *                                      (the eligibility gate), issues the auth
 *                                      code, and returns the client redirect URL.
 *   - POST /oauth/authorize/deny     — Verifies + consumes the bag and returns
 *                                      the client redirect URL with
 *                                      `error=access_denied`.
 *
 * -------------------------------------------------------------------------
 * @Public() + manual Firebase verification
 * -------------------------------------------------------------------------
 * All four routes are marked `@Public()` so the global `AuthGuard` skips them.
 * Firebase ID token verification is performed inline using the
 * `FIREBASE_ADMIN` provider. This is required because `GET /oauth/authorize`
 * must respond with a `302` to `FRONTEND_URL/login` when the user has no
 * session — the global AuthGuard would instead throw a JSON 401, which is
 * unusable for a browser-initiated OAuth flow.
 *
 * The POST endpoints respond with `401 Unauthorized` (JSON) when called
 * without a valid Firebase session — they are called by the FE consent page
 * via fetch, so a 302 would be wrong there.
 *
 * -------------------------------------------------------------------------
 * Daubert adaptations vs. belong-mc
 * -------------------------------------------------------------------------
 * 1. NO `scope` parameter — the OAuth scope concept is replaced by the
 *    `organizationId` chosen at CONSENT time. The bag payload therefore
 *    omits `scope` (see `StateBagPayload`).
 * 2. NO MFA gate — Daubert has no MFA today.
 * 3. NO internal-email gate — Daubert is multi-tenant; access is governed by
 *    `organization_members.role` (admin/member/guest).
 * 4. The consent picker is built BACKEND-side from the authenticated user's
 *    `organization_members` rows. A client-supplied org list is never trusted.
 * 5. Eligibility gate: only `role ∈ {admin, member}` may grant an OAuth
 *    session. `guest` (and non-members) are rejected with 403. The same gate
 *    is re-checked at refresh-token rotation in `OAuthService` and again
 *    per-tool-call in the MCP request path.
 * 6. `code_challenge_method=S256` is the only accepted PKCE method.
 *
 * Redirect-URI safety: the allowlist check happens BEFORE any auth lookup so
 * an attacker cannot use the endpoint as an open redirect (an unknown
 * `client_id` or mismatched `redirect_uri` returns 400 without contacting
 * Firebase or touching session state).
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request, Response } from 'express';
import * as admin from 'firebase-admin';
import { In, Repository } from 'typeorm';

import { OAuthClientEntity } from '../../database/entities/oauth-client.entity';
import {
  OrganizationMemberEntity,
  OrgRole,
} from '../../database/entities/organization-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { FIREBASE_ADMIN } from '../auth/firebase-admin.provider';
import { Public } from '../auth/public.decorator';
import { UsersService } from '../users/users.service';
import { OAuthService } from './oauth.service';
import { StateBagPayload, StateBagService } from './state-bag.service';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface AuthorizeQuery {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string; // client's opaque state — passed through as `clientState`
}

/** JSON body sent by `POST /oauth/authorize/preview`. */
interface AuthorizePreviewBody {
  bag?: string;
}

/** A single org the authenticated user may consent on behalf of. */
export interface EligibleOrgSummary {
  id: string;
  slug: string;
  name: string;
  role: 'admin' | 'member';
}

/** Response shape for `POST /oauth/authorize/preview`. */
export interface AuthorizePreviewResponse {
  clientId: string;
  clientDisplayName: string;
  redirectUri: string;
  clientState: string | null;
  eligibleOrgs: EligibleOrgSummary[];
}

/** JSON body sent by `POST /oauth/authorize/complete`. */
interface AuthorizeCompleteBody {
  bag?: string;
  organizationId?: string;
}

/** JSON body sent by `POST /oauth/authorize/deny`. */
interface AuthorizeDenyBody {
  bag?: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller()
export class AuthorizeController {
  private readonly logger = new Logger(AuthorizeController.name);

  constructor(
    @Inject(FIREBASE_ADMIN) private readonly firebaseApp: admin.app.App,
    private readonly users: UsersService,
    private readonly stateBag: StateBagService,
    private readonly oauthService: OAuthService,
    private readonly config: ConfigService,
    @InjectRepository(OAuthClientEntity)
    private readonly clientRepo: Repository<OAuthClientEntity>,
    @InjectRepository(OrganizationMemberEntity)
    private readonly memberRepo: Repository<OrganizationMemberEntity>,
  ) {}

  // -------------------------------------------------------------------------
  // GET /oauth/authorize
  // -------------------------------------------------------------------------

  /**
   * OAuth 2.1 authorization endpoint.
   *
   * Happy path:
   *   1. Validate `response_type=code`, `code_challenge_method=S256`,
   *      `code_challenge`, `client_id` (exists in DB), `redirect_uri`
   *      (exact match against client's allowlist).
   *   2. Manually verify Firebase ID token from `Authorization: Bearer`.
   *      If absent/invalid → `302 ${FRONTEND_URL}/login?return_to=<originalUrl>`.
   *   3. Sign the state-bag (no scope; org chosen at consent) → `302
   *      ${FRONTEND_URL}/oauth/consent?bag=<urlencoded bag>`.
   *
   * NOTE: redirect-URI validation runs BEFORE the Firebase lookup so an
   * attacker can't trick the endpoint into acting as an open redirect.
   */
  @Public()
  @Get('oauth/authorize')
  async authorize(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as unknown as AuthorizeQuery;
    const {
      response_type,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      state,
    } = query;

    // ------------------------------------------------------------------
    // 1. Parameter validation (BEFORE any auth lookup).
    // ------------------------------------------------------------------

    if (response_type !== 'code') {
      res.status(400).json({ error: 'unsupported_response_type' });
      return;
    }

    if (code_challenge_method !== 'S256') {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256',
      });
      return;
    }

    if (!code_challenge) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'code_challenge is required',
      });
      return;
    }

    if (!client_id) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id is required',
      });
      return;
    }

    if (!redirect_uri) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'redirect_uri is required',
      });
      return;
    }

    // Validate client_id and redirect_uri against the registered allowlist
    // BEFORE any Firebase call. This blocks open-redirect abuse.
    const client = await this.clientRepo.findOne({
      where: { clientId: client_id },
    });
    if (!client) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'unknown client',
      });
      return;
    }

    if (!client.redirectUris.includes(redirect_uri)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'redirect_uri mismatch',
      });
      return;
    }

    // ------------------------------------------------------------------
    // 2. Firebase session check.
    // ------------------------------------------------------------------

    const user = await this.verifyFirebaseSession(req);

    if (!user) {
      // No valid Firebase session → 302 to the FE login page with return_to
      // so the FE can re-invoke the OAuth flow after sign-in. NOTE: browser
      // GETs don't carry a Bearer header; this is the path most OAuth
      // clients hit on first connect.
      const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
      const returnTo = encodeURIComponent(this.buildOriginalUrl(req));
      res.redirect(302, `${frontendUrl}/login?return_to=${returnTo}`);
      return;
    }

    // ------------------------------------------------------------------
    // 3. Sign state-bag and redirect to the FE consent page.
    // ------------------------------------------------------------------

    const bag = this.stateBag.sign({
      ownerUserId: user.id,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: 'S256',
      clientState: state ?? null,
      requestedAt: Date.now(),
    });

    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    res.redirect(
      302,
      `${frontendUrl}/oauth/consent?bag=${encodeURIComponent(bag)}`,
    );
  }

  // -------------------------------------------------------------------------
  // POST /oauth/authorize/preview
  // -------------------------------------------------------------------------

  /**
   * Consent preview endpoint — called by the FE consent page on mount to read
   * the bag payload without consuming it (uses `StateBagService.peek`) and
   * to fetch the authenticated user's eligible orgs for the org picker.
   *
   * Steps:
   *   1. Manually verify Firebase session → 401 if absent/invalid.
   *   2. Parse + peek the signed bag (HMAC + TTL; does NOT mark bag consumed).
   *   3. Assert `bag.ownerUserId === user.id` → 403 on mismatch.
   *   4. Look up `OAuthClient` for display name → 400 if missing.
   *   5. Load the caller's `organization_members` rows where `role ∈
   *      {admin, member}` and shape them as `{id, slug, name, role}`.
   *   6. Return preview payload.
   *
   * The org picker on the consent screen is rendered from `eligibleOrgs` —
   * the FE never sends an org list; it only echoes a chosen `organizationId`
   * back to `/oauth/authorize/complete`.
   */
  @Public()
  @Post('oauth/authorize/preview')
  @HttpCode(200)
  async preview(
    @Req() req: Request,
    @Body() body: AuthorizePreviewBody,
  ): Promise<AuthorizePreviewResponse> {
    const user = await this.verifyFirebaseSession(req);
    if (!user) {
      throw new UnauthorizedException('authentication_required');
    }

    if (!body.bag) {
      throw new BadRequestException('bag is required');
    }

    const payload = this.stateBag.peek(body.bag);

    if (payload.ownerUserId !== user.id) {
      throw new ForbiddenException('invalid_bag_owner');
    }

    const client = await this.clientRepo.findOne({
      where: { clientId: payload.clientId },
    });
    if (!client) {
      throw new BadRequestException('unknown_client');
    }

    const eligibleOrgs = await this.loadEligibleOrgs(user.id);

    return {
      clientId: payload.clientId,
      clientDisplayName: client.displayName,
      redirectUri: payload.redirectUri,
      clientState: payload.clientState,
      eligibleOrgs,
    };
  }

  // -------------------------------------------------------------------------
  // POST /oauth/authorize/complete
  // -------------------------------------------------------------------------

  /**
   * Consent completion endpoint — called by the FE consent screen after the
   * user picks an org and clicks Allow.
   *
   * Steps:
   *   1. Manually verify Firebase session → 401 if absent/invalid.
   *   2. Parse + verify the signed bag (HMAC + TTL + single-use via PK insert).
   *      `verify` is single-use; once consumed it cannot be re-used (including
   *      via the deny endpoint).
   *   3. Assert `bag.ownerUserId === user.id` → 403 on mismatch.
   *   4. **Eligibility gate** — assert the user has an
   *      `organization_members` row for `organizationId` with role ∈
   *      {admin, member}. Guests and non-members are rejected with 403 and
   *      the auth code is NOT issued.
   *   5. `OAuthService.issueCode(...)` with the chosen `organizationId`.
   *   6. Build and return `{ redirectUrl }`.
   *
   * Returns JSON `{ redirectUrl }` — the FE drives `window.location =
   * redirectUrl` after the success animation (NOT a 302; the FE controls the
   * final redirect to keep the consent UX smooth).
   */
  @Public()
  @Post('oauth/authorize/complete')
  @HttpCode(200)
  async complete(
    @Req() req: Request,
    @Body() body: AuthorizeCompleteBody,
  ): Promise<{ redirectUrl: string }> {
    const user = await this.verifyFirebaseSession(req);
    if (!user) {
      throw new UnauthorizedException('authentication_required');
    }

    if (!body.bag) {
      throw new BadRequestException('bag is required');
    }
    if (!body.organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    const organizationId = body.organizationId;

    const payload = await this.stateBag.verify(body.bag);

    if (payload.ownerUserId !== user.id) {
      throw new ForbiddenException('invalid_bag_owner');
    }

    // Eligibility gate: the caller must be admin or member of the chosen org.
    // Guests and non-members → 403, no code issued.
    const membership = await this.memberRepo.findOne({
      where: { userId: user.id, organizationId },
    });
    if (!membership || membership.role === 'guest') {
      throw new ForbiddenException('not_eligible_for_organization');
    }

    const code = await this.oauthService.issueCode({
      ownerUserId: payload.ownerUserId,
      clientId: payload.clientId,
      organizationId,
      codeChallenge: payload.codeChallenge,
      codeChallengeMethod: payload.codeChallengeMethod,
      redirectUri: payload.redirectUri,
      state: payload.clientState,
    });

    return { redirectUrl: this.buildRedirectUrl(payload, { code }) };
  }

  // -------------------------------------------------------------------------
  // POST /oauth/authorize/deny
  // -------------------------------------------------------------------------

  /**
   * Consent denial endpoint — called by the FE consent screen after the user
   * clicks Deny.
   *
   * Steps:
   *   1. Manually verify Firebase session → 401 if absent/invalid.
   *   2. Parse + verify the signed bag (HMAC + TTL + single-use via PK insert).
   *      Consuming the bag on deny is intentional: it prevents a race where
   *      one tab denies while another tab allows with the same bag.
   *   3. Assert `bag.ownerUserId === user.id` → 403 on mismatch.
   *   4. Build and return `{ redirectUrl }` with `error=access_denied`.
   */
  @Public()
  @Post('oauth/authorize/deny')
  @HttpCode(200)
  async deny(
    @Req() req: Request,
    @Body() body: AuthorizeDenyBody,
  ): Promise<{ redirectUrl: string }> {
    const user = await this.verifyFirebaseSession(req);
    if (!user) {
      throw new UnauthorizedException('authentication_required');
    }

    if (!body.bag) {
      throw new BadRequestException('bag is required');
    }

    const payload = await this.stateBag.verify(body.bag);

    if (payload.ownerUserId !== user.id) {
      throw new ForbiddenException('invalid_bag_owner');
    }

    return {
      redirectUrl: this.buildRedirectUrl(payload, { error: 'access_denied' }),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Attempts to verify the Firebase ID token from `Authorization: Bearer
   * <token>` and resolve the corresponding `UserEntity`.
   *
   * Returns the user on success, or `null` if:
   *   - No `Authorization` header is present (or not a Bearer).
   *   - Firebase rejects the token.
   *   - No `UserEntity` row exists for the resolved uid.
   *
   * Callers that need a 302 on absence (the GET endpoint) check for `null`
   * and redirect; callers that need a 401 (the POST endpoints) throw
   * `UnauthorizedException`.
   */
  private async verifyFirebaseSession(req: Request): Promise<UserEntity | null> {
    const auth = req.headers?.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;

    const token = auth.slice('Bearer '.length).trim();
    if (!token) return null;

    try {
      const decoded = await this.firebaseApp.auth().verifyIdToken(token);
      const user = await this.users.findByFirebaseUid(decoded.uid);
      return user ?? null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Firebase token verification failed: ${msg}`);
      return null;
    }
  }

  /**
   * Loads the caller's eligible-for-consent organizations: rows in
   * `organization_members` where `role ∈ {admin, member}`, joined to the
   * organization for slug/name display.
   *
   * Guests are intentionally excluded — they cannot grant OAuth access to an
   * organization.
   */
  private async loadEligibleOrgs(userId: string): Promise<EligibleOrgSummary[]> {
    const ELIGIBLE_ROLES: OrgRole[] = ['admin', 'member'];
    const rows = await this.memberRepo.find({
      where: { userId, role: In(ELIGIBLE_ROLES) },
      relations: { organization: true },
    });

    return rows.map((row) => ({
      id: row.organizationId,
      slug: row.organization.slug,
      name: row.organization.name,
      role: row.role as 'admin' | 'member',
    }));
  }

  /**
   * Reconstructs the original full URL of the incoming request (path + query
   * string). Used to build `return_to` for the `/login` redirect.
   */
  private buildOriginalUrl(req: Request): string {
    return req.originalUrl ?? req.url ?? '/oauth/authorize';
  }

  /**
   * Builds the final redirect URL back to the OAuth client. Used by both
   * `complete` (with `code=`) and `deny` (with `error=access_denied`).
   *
   * `URLSearchParams.set()` handles percent-encoding internally — do NOT wrap
   * values in `encodeURIComponent()` first or they will be double-encoded
   * (e.g. a space becomes `%2520` instead of `%20`), which breaks OAuth
   * clients that compare the returned `state` against the value they sent.
   */
  private buildRedirectUrl(
    payload: StateBagPayload,
    extras: Record<string, string>,
  ): string {
    const params = new URLSearchParams(extras);
    if (payload.clientState) {
      params.set('state', payload.clientState);
    }
    return `${payload.redirectUri}?${params.toString()}`;
  }
}
