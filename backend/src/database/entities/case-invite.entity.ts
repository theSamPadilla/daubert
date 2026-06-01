import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { UserEntity } from './user.entity';

export type InviteRole = 'editor' | 'viewer';

@Entity('case_invites')
export class CaseInviteEntity extends BaseEntity {
  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Index()
  @Column({ type: 'varchar' })
  email: string; // always lowercased

  @Column({ type: 'varchar' })
  role: InviteRole;

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
