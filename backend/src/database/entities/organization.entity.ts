import { Entity, Column, OneToMany, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { OrganizationMemberEntity } from './organization-member.entity';

@Entity('organizations')
export class OrganizationEntity extends BaseEntity {
  @Column()
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  slug: string;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @OneToMany(() => OrganizationMemberEntity, (m) => m.organization, { cascade: true })
  members: OrganizationMemberEntity[];

  @OneToMany(() => CaseEntity, (c) => c.organization)
  cases: CaseEntity[];
}
