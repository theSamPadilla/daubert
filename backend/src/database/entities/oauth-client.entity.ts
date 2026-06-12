import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Registered MCP client applications permitted to use the OAuth 2.1
 * authorization server. All registered clients are public clients
 * (PKCE-only; no `client_secret` involved).
 *
 * Dynamic Client Registration (RFC 7591) is supported. Anthropic surfaces
 * (Claude Desktop, claude.ai, Claude Code) self-register via
 * `POST /oauth/register` on first connect; rows have `isDynamic = true`.
 * Pre-seeded entries are still allowed for fixed integration clients.
 */
@Entity('oauth_client')
export class OAuthClientEntity {
  /**
   * Stable client identifier. For dynamically-registered clients this is a
   * server-generated opaque string; for pre-seeded clients it is a
   * human-readable handle (e.g. `claude-desktop`). Used as the `client_id`
   * in the OAuth 2.1 authorization request.
   */
  @PrimaryColumn({ name: 'client_id', type: 'varchar', length: 64 })
  clientId: string;

  /**
   * Human-readable label shown on the consent screen (e.g. "Claude Desktop").
   * For dynamic clients this is sourced from the registration request's
   * `client_name` field; for pre-seeded rows it is the operator-supplied
   * label.
   */
  @Column({ name: 'display_name', type: 'varchar', length: 128 })
  displayName: string;

  /**
   * Exact redirect URIs allowed for this client.
   * Stored as a Postgres text[] column. The `redirect_uri` in any authorization
   * request must be an exact match against one of these values.
   */
  @Column('text', { name: 'redirect_uris', array: true })
  redirectUris: string[];

  /**
   * Always true in V1 — all registered MCP clients are public (no client
   * secret). Stored for forward-compatibility should a confidential client
   * ever be registered.
   */
  @Column({ name: 'is_public_client', type: 'boolean', default: true })
  isPublicClient: boolean;

  /**
   * `true` for rows created via RFC 7591 Dynamic Client Registration (the
   * default for Claude surfaces). `false` for pre-seeded rows.
   */
  @Column({ name: 'is_dynamic', type: 'boolean', default: false })
  isDynamic: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
