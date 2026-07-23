import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { ConversationEntity } from './conversation.entity';
import { MessageEntity } from './message.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from './user.entity';

export type TokenUsageSurface = 'chat' | 'title-generation' | 'declarant-extraction';

@Entity('token_usage')
@Index(['orgId', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['caseId', 'createdAt'])
@Index(['conversationId'])
export class TokenUsageEntity extends BaseEntity {
  @Column({ name: 'org_id', type: 'uuid', nullable: true })
  orgId: string | null;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @Column({ name: 'case_id', type: 'uuid', nullable: true })
  caseId: string | null;

  @ManyToOne(() => CaseEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity | null;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @ManyToOne(() => ConversationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ConversationEntity | null;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  @ManyToOne(() => MessageEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'message_id' })
  message: MessageEntity | null;

  @Column({ type: 'varchar', length: 32 })
  surface: TokenUsageSurface;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({ name: 'cache_read_input_tokens', type: 'int', default: 0 })
  cacheReadInputTokens: number;

  @Column({ name: 'cache_creation_5m_input_tokens', type: 'int', default: 0 })
  cacheCreation5mInputTokens: number;

  @Column({ name: 'cache_creation_1h_input_tokens', type: 'int', default: 0 })
  cacheCreation1hInputTokens: number;
}
