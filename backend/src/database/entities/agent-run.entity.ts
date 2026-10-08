import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ConversationEntity } from './conversation.entity';
import { CaseRole } from './case-member.entity';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'interrupted';

export type TerminalRunStatus = Exclude<AgentRunStatus, 'queued' | 'running'>;

export const ACTIVE_RUN_STATUSES: AgentRunStatus[] = ['queued', 'running'];

/** Name of the partial unique index; matched on unique-violation errors. */
export const ACTIVE_RUN_INDEX = 'uq_agent_runs_active_per_conversation';

export interface RunError {
  errorId: string;
  /** User-safe message, shown in the chat. */
  message: string;
}

/**
 * One agent turn, executed server-side independently of any browser request
 * (see docs/agent-runs.md). The partial unique index allows at most one
 * queued/running run per conversation.
 */
@Entity('agent_runs')
@Index(ACTIVE_RUN_INDEX, ['conversationId'], {
  unique: true,
  where: `"status" IN ('queued', 'running')`,
})
@Index('ix_agent_runs_conversation_created', ['conversationId', 'createdAt'])
export class AgentRunEntity extends BaseEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ConversationEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', default: 'queued' })
  status: AgentRunStatus;

  /** The user row this run answers. Set by the launcher before dispatch. */
  @Column({ name: 'user_message_id', type: 'uuid', nullable: true })
  userMessageId: string | null;

  @Column({ name: 'case_id', type: 'uuid', nullable: true })
  caseId: string | null;

  @Column({ name: 'investigation_id', type: 'uuid', nullable: true })
  investigationId: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  /** Caller's case role when the run was started; picks the tool set. */
  @Column({ name: 'viewer_role', type: 'varchar' })
  viewerRole: CaseRole;

  @Column({ name: 'cancel_requested_at', type: 'timestamptz', nullable: true })
  cancelRequestedAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  /** Lease: the executor bumps this every few seconds while it is alive. */
  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  error: RunError | null;
}
