import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from './user.entity';

export type OrgInviteRole = 'member' | 'guest';

@Entity('organization_invites')
export class OrganizationInviteEntity extends BaseEntity {
  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;

  @Index()
  @Column({ type: 'varchar' })
  email: string;

  @Column({ type: 'varchar' })
  role: OrgInviteRole;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  code: string;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ name: 'created_by_user_id' })
  createdByUserId: string;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: UserEntity;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @Column({ name: 'used_by_user_id', nullable: true })
  usedByUserId: string | null;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'used_by_user_id' })
  usedBy: UserEntity | null;
}
