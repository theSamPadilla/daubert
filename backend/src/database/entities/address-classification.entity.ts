import { Entity, Column, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * A machine-derived, on-chain fact about an address: does it have bytecode, and
 * if so what token standard does it implement.
 *
 * Deliberately separate from `labeled_entities`, which is human-curated
 * attribution ("this is Binance"). The two differ in provenance, in write path,
 * and in key: attribution is chain-agnostic, whereas the same address can carry
 * bytecode on one chain and nothing on another, so classification is only
 * meaningful per `(chain, address)`.
 *
 * Rows are only written for probes the chain actually answered. Absence means
 * "not yet asked", never "asked and got nothing".
 */
@Entity('address_classifications')
@Unique(['chain', 'address'])
export class AddressClassificationEntity extends BaseEntity {
  @Column()
  chain: string;

  /** Canonical form per `normalizeAddressForChain`: EVM lowercased, base58 case-preserved. */
  @Column()
  address: string;

  @Column({ name: 'address_type', type: 'varchar' })
  addressType: 'wallet' | 'contract';

  @Column({ name: 'token_standard', type: 'varchar', nullable: true })
  tokenStandard: string | null;

  @Column({ type: 'varchar', nullable: true })
  symbol: string | null;

  @Column({ type: 'int', nullable: true })
  decimals: number | null;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  /**
   * When the chain was last asked. Bytecode is immutable so a successful answer
   * never needs refreshing; this exists so a later change can negative-cache
   * addresses the chain could not answer for, rather than have every viewer
   * re-probe the most expensive addresses on every load.
   */
  @Column({ name: 'probed_at', type: 'timestamp' })
  probedAt: Date;
}
