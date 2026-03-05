import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { InvestigationEntity } from './investigation.entity';

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

  @Column({ name: 'investigation_id' })
  investigationId: string;

  @ManyToOne(() => InvestigationEntity, (i) => i.scriptRuns, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'investigation_id' })
  investigation: InvestigationEntity;
}
