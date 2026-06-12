import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * Replay cache for the signed state-bag used during the OAuth consent flow.
 *
 * When `POST /oauth/authorize/complete` validates and consumes a signed
 * state-bag, it inserts a row here with the bag's stable ID (a SHA-256 of
 * the bag contents). Any second `POST /oauth/authorize/complete` carrying
 * the same bag is rejected by PK collision — CSRF / replay protection.
 *
 * Daily housekeeping purges rows where `expiresAt < now()`. The TTL matches
 * the bag TTL: 10 minutes from consumption.
 */
@Entity('oauth_consumed_state')
export class OAuthConsumedStateEntity {
  /**
   * Stable ID of the consumed state-bag.
   * Derived as a SHA-256 hex of the raw bag payload so it is both compact and
   * collision-resistant. Used as a PK to provide O(1) duplicate detection.
   */
  @PrimaryColumn({ name: 'bag_id', type: 'varchar', length: 64 })
  bagId: string;

  /** Timestamp when the bag was consumed (defaults to `now()`). */
  @Column({
    name: 'consumed_at',
    type: 'timestamp',
    default: () => 'now()',
  })
  consumedAt: Date;

  /**
   * Rows with `expiresAt < now()` are safe to delete.
   * Set to 10 minutes after `consumedAt`, matching the bag TTL.
   */
  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;
}
