import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { CaseMemberEntity } from './case-member.entity';

@Entity('users')
export class UserEntity extends BaseEntity {
  @Column({ name: 'firebase_uid', type: 'varchar', nullable: true, unique: true })
  firebaseUid: string | null;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl: string | null;

  // Legacy relation — kept until userId column is dropped from cases
  @OneToMany(() => CaseEntity, (c) => c.user)
  cases: CaseEntity[];

  @OneToMany(() => CaseMemberEntity, (m) => m.user)
  memberships: CaseMemberEntity[];
}
