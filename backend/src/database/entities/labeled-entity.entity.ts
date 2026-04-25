import { Entity, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum EntityCategory {
  EXCHANGE = 'exchange',
  MIXER = 'mixer',
  BRIDGE = 'bridge',
  PROTOCOL = 'protocol',
  INDIVIDUAL = 'individual',
  CONTRACT = 'contract',
  GOVERNMENT = 'government',
  CUSTODIAN = 'custodian',
  OTHER = 'other',
}

@Entity('labeled_entities')
export class LabeledEntityEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'varchar' })
  category: EntityCategory;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  wallets: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
