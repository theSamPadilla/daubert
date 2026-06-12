import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Append-only audit trail for actions performed by an external agent via the
 * OAuth-authenticated MCP server. One row per attempted tool call.
 *
 * `sessionId` references `oauth_session.id` but is intentionally NOT a FK:
 * sessions are soft-revoked (never deleted), so the column carries the
 * attribution forever without a constraint to maintain. An index keeps
 * "show me what session X did" queries fast.
 */
@Entity('agent_audit_log')
export class AgentAuditLogEntity extends BaseEntity {
  @Index('ix_agent_audit_log_session_id')
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** e.g. `import_transactions`, `read_trace`, `list_cases`. */
  @Column({ type: 'varchar', length: 64 })
  action: string;

  /** Optional pointer to the affected resource (e.g. `trace:<uuid>`). */
  @Column({ name: 'target_ref', type: 'varchar', length: 255, nullable: true })
  targetRef: string | null;

  /** `ok` on success, `error` on failure. */
  @Column({ type: 'varchar', length: 16 })
  status: string;

  /** Free-form structured detail — typed args, error message, counts, etc. */
  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;
}
