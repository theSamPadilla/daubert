import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { InvestigationEntity } from './investigation.entity';
import { UserEntity } from './user.entity';

@Entity('cases')
export class CaseEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ name: 'start_date', type: 'timestamp', nullable: true })
  startDate: Date | null;

  @Column({ type: 'jsonb', default: '[]' })
  links: { url: string; label: string }[];

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, (u) => u.cases, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @OneToMany(() => InvestigationEntity, (inv) => inv.case, { cascade: true })
  investigations: InvestigationEntity[];

}
