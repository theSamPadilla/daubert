import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { InvestigationEntity } from './investigation.entity';
import { CaseEntity } from './case.entity';

@Entity('script_runs')
export class ScriptRunEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text' })
  code: string;

  @Column({ type: 'text', nullable: true })
  output: string | null;

  @Column({ type: 'varchar', length: 20, default: 'success' })
  status: 'success' | 'error' | 'timeout';

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @ManyToOne(() => CaseEntity, (c) => c.scriptRuns, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Column({ name: 'investigation_id', type: 'uuid', nullable: true })
  investigationId: string | null;

  @ManyToOne(() => InvestigationEntity, (i) => i.scriptRuns, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'investigation_id' })
  investigation: InvestigationEntity | null;
}
