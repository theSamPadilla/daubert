import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { TraceEntity } from './trace.entity';

@Entity('investigations')
export class InvestigationEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, (c) => c.investigations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @OneToMany(() => TraceEntity, (t) => t.investigation, { cascade: true })
  traces: TraceEntity[];
}
