import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Short-lived authorization codes issued by `GET /oauth/authorize` (via
 * `POST /oauth/authorize/complete`). TTL: 60 seconds from issue.
 *
 * Single-use: `consumedAt` is set the moment the code is exchanged via
 * `POST /oauth/token`. Any second attempt to exchange a consumed code is
 * rejected.
 *
 * `codeChallengeMethod` is stored per row but is always `'S256'` in V1 — the
 * only method permitted. The constraint is enforced in the service layer,
 * not as a DB CHECK.
 *
 * Daubert adaptation: there is no `scope` column. Sessions (and the codes
 * that create them) are scoped to a single (owner, organization) pair via
 * `organization_id`; effective permissions are derived from membership.
 */
@Entity('oauth_code')
export class OAuthCodeEntity {
  /**
   * The opaque authorization code returned to the redirect URI.
   * Stored as SHA-256 hex of the raw code value (the raw form is delivered
   * to the client once and never persisted). 60-second TTL from `expiresAt`.
   */
  @PrimaryColumn({ name: 'code', type: 'varchar', length: 128 })
  code: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'client_id', type: 'varchar', length: 64 })
  clientId: string;

  /**
   * The PKCE code challenge (base64url-encoded SHA-256 of the verifier).
   * Verified against the `code_verifier` supplied in the token exchange.
   */
  @Column({ name: 'code_challenge', type: 'varchar', length: 128 })
  codeChallenge: string;

  /**
   * Always `'S256'` in V1 — plain PKCE and no-PKCE are rejected at the service
   * layer. Column is stored for forward-compatibility and audit clarity.
   */
  @Column({ name: 'code_challenge_method', type: 'varchar', length: 16 })
  codeChallengeMethod: string;

  /** The exact redirect URI that was supplied in the authorization request. */
  @Column({ name: 'redirect_uri', type: 'varchar', length: 2048 })
  redirectUri: string;

  /**
   * The opaque `state` parameter echoed back to the client on redirect.
   * Nullable — clients may omit `state` (though it is recommended for CSRF).
   */
  @Column({ name: 'state', type: 'varchar', length: 512, nullable: true })
  state: string | null;

  /** Expiry timestamp — 60 seconds from code issuance. */
  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  /** Set when the code is consumed via `POST /oauth/token`. */
  @Column({ name: 'consumed_at', type: 'timestamp', nullable: true })
  consumedAt: Date | null;
}
