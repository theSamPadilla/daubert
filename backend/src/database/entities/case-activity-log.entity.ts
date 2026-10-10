import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CaseEntity } from './case.entity';
import { UserEntity } from './user.entity';

export type CaseActivitySource = 'chat' | 'mcp';
export type CaseActivityStatus = 'ok' | 'error';

/**
 * Append-only record of what an AI agent did on a case: the in-app chat agent
 * or an external agent over MCP. Kept for the life of the case and not touched
 * by chat retention (docs/chat-retention.md). Nothing in the codebase updates
 * or deletes rows; they go when their case is deleted.
 */
@Entity('case_activity_log')
@Index('ix_case_activity_log_case_created', ['caseId', 'createdAt', 'id'])
export class CaseActivityLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Millisecond precision so a JS Date round-trips exactly in the paging cursor.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt: Date;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @ManyToOne(() => CaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  /** The person the agent acted for. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @Column({ type: 'varchar', length: 16 })
  source: CaseActivitySource;

  /** Chat: the model that answered. MCP: the session's surface label, e.g. "Claude Desktop". */
  @Column({ type: 'varchar', length: 255, nullable: true })
  agent: string | null;

  /** Plain column, no FK: chats are purged after 30 days, the id still groups a session. */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  /** Plain column matching agent_audit_log.session_id. */
  @Column({ name: 'mcp_session_id', type: 'uuid', nullable: true })
  mcpSessionId: string | null;

  /** Tool name. */
  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'jsonb' })
  input: unknown;

  @Column({ type: 'varchar', length: 16 })
  status: CaseActivityStatus;

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  /** Rebuilt from chat messages by the AddCaseActivityLog migration. */
  @Column({ type: 'boolean', default: false })
  backfilled: boolean;
}
