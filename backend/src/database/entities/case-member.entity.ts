import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { UserEntity } from './user.entity';
import { CaseEntity } from './case.entity';

export type CaseRole = 'owner' | 'guest';

@Entity('case_members')
@Unique(['userId', 'caseId'])
export class CaseMemberEntity extends BaseEntity {
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, (u) => u.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, (c) => c.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Column({ type: 'varchar', default: 'guest' })
  role: CaseRole;
}
