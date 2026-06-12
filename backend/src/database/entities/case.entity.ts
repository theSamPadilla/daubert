import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { InvestigationEntity } from './investigation.entity';
import { OrganizationEntity } from './organization.entity';
import { ProductionEntity } from './production.entity';
import { UserEntity } from './user.entity';
import { CaseMemberEntity } from './case-member.entity';
import { ScriptRunEntity } from './script-run.entity';

@Entity('cases')
export class CaseEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  // Legacy — kept until phase 4 cleanup drops this column
  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, (u) => u.cases, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @OneToMany(() => InvestigationEntity, (inv) => inv.case, { cascade: true })
  investigations: InvestigationEntity[];

  @OneToMany(() => CaseMemberEntity, (m) => m.case, { cascade: true })
  members: CaseMemberEntity[];

  @OneToMany(() => ProductionEntity, (p) => p.case, { cascade: true })
  productions: ProductionEntity[];

  @OneToMany(() => ScriptRunEntity, (s) => s.case)
  scriptRuns: ScriptRunEntity[];

  @Column({ name: 'organization_id' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, (o) => o.cases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;
}
