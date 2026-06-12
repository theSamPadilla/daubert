import { createHash, createHmac, timingSafeEqual } from 'crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OAuthConsumedStateEntity } from 'src/database/entities/oauth-consumed-state.entity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The payload that is HMAC-signed and forwarded to the FE consent page
 * as a signed state-bag.
 *
 * Field notes:
 *   - `ownerUserId`         — the User PK for the authenticated user.
 *   - `clientId`            — the `oauth_client.client_id` value.
 *   - `redirectUri`         — exact redirect URI (already validated vs allowlist).
 *   - `codeChallenge`       — PKCE S256 challenge from the original request.
 *   - `codeChallengeMethod` — always `'S256'`.
 *   - `clientState`         — the OAuth `state` query param passed by the
 *                             client; opaque to us, passed through verbatim.
 *   - `requestedAt`         — unix ms at the time the bag was created; used
 *                             for TTL enforcement (10-minute expiry).
 *
 * Note: `scope` is intentionally absent — in Daubert the org is chosen at
 * the consent step, not the authorize step.
 */
export interface StateBagPayload {
  ownerUserId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  clientState: string | null;
  requestedAt: number; // unix ms
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** State-bag TTL: 10 minutes in milliseconds. */
const BAG_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * StateBagService — creates and verifies signed state-bags for the OAuth
 * consent flow.
 *
 * The bag encodes the authorized OAuth parameters so that
 * `POST /oauth/authorize/complete` can trust the FE-forwarded payload without
 * re-querying the DB or maintaining server-side session state. Replay
 * protection is provided by a Postgres `oauth_consumed_state` table (PK
 * collision → rejected).
 *
 * Bag wire format:  `base64url(JSON).base64url(HMAC-SHA256)`
 *
 * OAUTH_STATE_SECRET is validated in env.validation.ts (required, min 32 chars).
 * The explicit length check below is belt-and-braces — env validation runs first
 * at startup, but a misconfigured test or integration environment could bypass it.
 */
@Injectable()
export class StateBagService implements OnModuleInit {
  private readonly logger = new Logger(StateBagService.name);
  private secret!: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(OAuthConsumedStateEntity)
    private readonly consumedStateRepo: Repository<OAuthConsumedStateEntity>,
  ) {}

  onModuleInit(): void {
    const secret = this.config.getOrThrow<string>('OAUTH_STATE_SECRET');
    if (secret.length < 32) {
      throw new Error(
        `StateBagService: OAUTH_STATE_SECRET is too short (${secret.length} chars; minimum 32).`,
      );
    }
    this.secret = secret;
    this.logger.log('StateBagService initialized with OAUTH_STATE_SECRET.');
  }

  // -------------------------------------------------------------------------
  // sign
  // -------------------------------------------------------------------------

  /**
   * Serializes `payload` to JSON, signs with HMAC-SHA256, and encodes as
   * `base64url(JSON).base64url(HMAC)`.
   *
   * The resulting string is URL-safe and can be passed as a query parameter
   * without further encoding (base64url uses `-` and `_` not `+` and `/`,
   * and the `.` separator has no special meaning in query strings).
   */
  sign(payload: StateBagPayload): string {
    const json = JSON.stringify(payload);
    const payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
    const hmac = createHmac('sha256', this.secret)
      .update(payloadB64)
      .digest('base64url');
    return `${payloadB64}.${hmac}`;
  }

  // -------------------------------------------------------------------------
  // verify
  // -------------------------------------------------------------------------

  /**
   * Verifies a bag string and returns the decoded payload.
   *
   * Checks performed (in order):
   *   1. Split on `.` — must have exactly two parts.
   *   2. HMAC recomputation + constant-time compare (tamper).
   *   3. TTL check — `requestedAt + 10min > now()`.
   *   4. Single-use — atomically inserts into `oauth_consumed_state`; a PK
   *      collision means the bag was already consumed.
   *
   * Throws `BadRequestException('invalid_or_expired_bag')` on any failure
   * except replay, which throws `BadRequestException('bag_already_consumed')`.
   */
  async verify(bag: string): Promise<StateBagPayload> {
    // Steps 1–3 (split + HMAC + TTL) are shared with peek().
    const payload = this.decodeAndValidate(bag);

    // 4. Single-use: atomically insert into consumed-state table.
    //    PK = SHA-256 hex of the raw bag string.
    const bagId = createHash('sha256').update(bag).digest('hex');
    const expiresAt = new Date(payload.requestedAt + BAG_TTL_MS);

    try {
      const row = this.consumedStateRepo.create({
        bagId,
        consumedAt: new Date(),
        expiresAt,
      });
      await this.consumedStateRepo.save(row);
    } catch (err: unknown) {
      // TypeORM wraps PK violations — check the code/constraint to distinguish
      // replay from an unexpected DB error.
      if (this.isUniqueConstraintError(err)) {
        throw new BadRequestException('bag_already_consumed');
      }
      // Unexpected error — re-throw so the caller knows something went wrong.
      throw err;
    }

    return payload;
  }

  // -------------------------------------------------------------------------
  // peek
  // -------------------------------------------------------------------------

  /**
   * Verifies a bag string and returns the decoded payload WITHOUT marking it
   * consumed. Used by `POST /oauth/authorize/preview` so the FE can read the
   * bag contents before the user clicks Allow or Deny.
   *
   * Checks performed (same as `verify`, minus the single-use PK insert):
   *   1. Split on `.` — must have exactly two parts.
   *   2. HMAC recomputation + constant-time compare (tamper).
   *   3. TTL check — `requestedAt + 10min > now()`.
   *
   * Does NOT insert into `oauth_consumed_state`, so the same bag can be used
   * for `peek` multiple times and then for a single `verify` call. Replay
   * protection is NOT provided here — it is the responsibility of the
   * consuming `verify` call.
   *
   * Throws `BadRequestException('invalid_or_expired_bag')` on any failure.
   */
  peek(bag: string): StateBagPayload {
    return this.decodeAndValidate(bag);
  }

  // -------------------------------------------------------------------------
  // Shared decode + validate (split + HMAC + TTL) — used by verify() and peek()
  // -------------------------------------------------------------------------

  private decodeAndValidate(bag: string): StateBagPayload {
    // 1. Split — bag is `<base64url(payload)>.<base64url(HMAC)>`.
    const dotIndex = bag.indexOf('.');
    if (dotIndex < 1) {
      throw new BadRequestException('invalid_or_expired_bag');
    }
    const payloadB64 = bag.slice(0, dotIndex);
    const receivedHmacB64 = bag.slice(dotIndex + 1);

    // 2. HMAC recomputation + constant-time compare.
    const expectedHmacB64 = createHmac('sha256', this.secret)
      .update(payloadB64)
      .digest('base64url');
    const expected = Buffer.from(expectedHmacB64, 'base64url');
    const received = Buffer.from(receivedHmacB64, 'base64url');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new BadRequestException('invalid_or_expired_bag');
    }

    // 3. Decode + TTL check.
    let payload: StateBagPayload;
    try {
      const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(json) as StateBagPayload;
    } catch {
      throw new BadRequestException('invalid_or_expired_bag');
    }
    if (
      typeof payload.requestedAt !== 'number' ||
      payload.requestedAt + BAG_TTL_MS <= Date.now()
    ) {
      throw new BadRequestException('invalid_or_expired_bag');
    }

    return payload;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether an error is a PostgreSQL unique-constraint violation
   * (SQLSTATE 23505). TypeORM surfaces this as a `QueryFailedError` with
   * `code = '23505'`.
   */
  private isUniqueConstraintError(err: unknown): boolean {
    if (err !== null && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      return e['code'] === '23505';
    }
    return false;
  }
}
