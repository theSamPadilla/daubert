import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from './user.entity';

@Entity('declarants')
export class DeclarantEntity extends BaseEntity {
  @Column({ name: 'display_name' })
  displayName: string;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column({ type: 'varchar', nullable: true })
  firm: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  qualifications: Record<string, unknown>[];

  @Column({ name: 'cv_exhibit', type: 'varchar', nullable: true })
  cvExhibit: string | null;

  @Column({ name: 'prior_testimony', type: 'jsonb', default: () => "'[]'::jsonb" })
  priorTestimony: string[];

  @Column({ name: 'hourly_rate', type: 'varchar', nullable: true })
  hourlyRate: string | null;

  @Column({ name: 'non_contingency_disclosure', type: 'text', nullable: true })
  nonContingencyDisclosure: string | null;

  @Column({ name: 'date_of_birth', type: 'varchar', nullable: true })
  dateOfBirth: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;
}
