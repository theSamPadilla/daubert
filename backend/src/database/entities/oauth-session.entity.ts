import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';
import { OrganizationEntity } from './organization.entity';
import { OAuthClientEntity } from './oauth-client.entity';

export type OAuthSessionRevokedReason =
  | 'user'
  | 'admin'
  | 'refresh_reuse'
  | 'owner_deactivated'
  | 'membership_revoked';

/**
 * One row per active connect-grant (i.e. one per device / surface that the
 * user has gone through the OAuth consent flow for).
 *
 * Per-device multiplicity is intentional. Multiple concurrent live sessions
 * for the same user + client are allowed (e.g. Claude Desktop on laptop +
 * Claude Desktop on desktop). The partial index below supports the
 * "is this surface already connected?" query efficiently without enforcing
 * uniqueness.
 *
 * Daubert adaptation: sessions are scoped to a single (owner, organization)
 * pair. Any tool call made through the session operates as that user inside
 * that org — never cross-org. There is no scope enum: the user's effective
 * permissions inside the org are derived live from their org/case membership.
 *
 * Revocation is always soft (`revokedAt` timestamp) — rows are never deleted
 * so that `agent_audit_log` attribution by `oauthSessionId` remains intact.
 */
@Entity('oauth_session')
@Index('ix_oauth_session_owner_org_active', ['ownerUserId', 'organizationId'], {
  where: '"revoked_at" IS NULL',
})
@Index('ix_oauth_session_access_token_hash', ['accessTokenHash'], {
  where: '"revoked_at" IS NULL',
  unique: true,
})
@Index('ix_oauth_session_refresh_token_hash', ['refreshTokenHash'], {
  where: '"revoked_at" IS NULL',
  unique: true,
})
export class OAuthSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id' })
  owner: UserEntity;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => OrganizationEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => OAuthClientEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client: OAuthClientEntity;

  @Column({ name: 'client_id', type: 'varchar', length: 64 })
  clientId: string;

  /**
   * Human-readable label for the connected surface.
   *
   * Defaults to `OAuthClientEntity.displayName` at consent time (e.g.
   * "Claude Desktop"). On the first MCP `initialize` request for this
   * session, `McpController` may augment this with `clientInfo.name +
   * clientInfo.version` and a UA-derived OS string. Augmentation failure is
   * non-fatal; the coarse label remains.
   */
  @Column({ name: 'surface_label', type: 'varchar', length: 255 })
  surfaceLabel: string;

  /**
   * SHA-256 hex of the current access token. The raw token is never persisted.
   * Lookup: `SELECT … WHERE access_token_hash = sha256(rawToken)`.
   */
  @Column({ name: 'access_token_hash', type: 'varchar', length: 64 })
  accessTokenHash: string;

  /**
   * SHA-256 hex of the current refresh token. Rotated on every exchange.
   * Presenting the old refresh token after rotation revokes the entire
   * session with `revokedReason = 'refresh_reuse'`.
   */
  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 64 })
  refreshTokenHash: string;

  @Column({ name: 'access_token_expires_at', type: 'timestamp' })
  accessTokenExpiresAt: Date;

  /** Sliding TTL — reset on every successful refresh exchange. */
  @Column({ name: 'refresh_token_expires_at', type: 'timestamp' })
  refreshTokenExpiresAt: Date;

  /** Updated (with write-damping) on each authenticated MCP call. */
  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({
    name: 'revoked_reason',
    type: 'enum',
    enum: [
      'user',
      'admin',
      'refresh_reuse',
      'owner_deactivated',
      'membership_revoked',
    ],
    enumName: 'oauth_session_revoked_reason',
    nullable: true,
  })
  revokedReason: OAuthSessionRevokedReason | null;
}
