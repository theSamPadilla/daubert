import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { InvestigationEntity } from './investigation.entity';

@Entity('cases')
export class CaseEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ name: 'start_date', type: 'timestamp', nullable: true })
  startDate: Date | null;

  @Column({ type: 'jsonb', default: '[]' })
  links: { url: string; label: string }[];

  @OneToMany(() => InvestigationEntity, (inv) => inv.case, { cascade: true })
  investigations: InvestigationEntity[];
}
