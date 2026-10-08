import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { AgentRunEntity } from './agent-run.entity';

/**
 * Append-only event log for one agent run, replayed to subscribers in seq
 * order. seq is 1-based and assigned in application code by whoever owns the
 * run (the executor, or the sweeper once the executor is declared dead), so
 * the table needs no sequence. Events of earlier runs in a conversation are
 * deleted when a new run starts.
 */
@Entity('agent_run_events')
export class AgentRunEventEntity {
  @PrimaryColumn({ name: 'run_id', type: 'uuid' })
  runId: string;

  @PrimaryColumn({ type: 'int' })
  seq: number;

  @ManyToOne(() => AgentRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: AgentRunEntity;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ type: 'jsonb' })
  data: unknown;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
