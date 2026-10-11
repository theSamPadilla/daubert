import { Entity, Column, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { MessageEntity } from './message.entity';
import { CaseEntity } from './case.entity';
import { UserEntity } from './user.entity';

@Entity('conversations')
@Index('IDX_conversations_case_user', ['caseId', 'userId'])
export class ConversationEntity extends BaseEntity {
  @Column({ nullable: true, type: 'varchar' })
  title: string | null;

  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  // Set when the chat retention purge deletes any of this conversation's
  // messages, so exports can say the history is incomplete.
  @Column({ name: 'history_truncated_at', type: 'timestamptz', nullable: true })
  historyTruncatedAt: Date | null;

  // Latest input-token count the model saw for this conversation, used to
  // offer "Continue in a new conversation" when the chat gets long.
  @Column({ name: 'context_tokens', type: 'int', default: 0 })
  contextTokens: number;

  // Model-written summary of the conversation this one continues. Chat
  // content: the retention purge clears it with the rest.
  @Column({ name: 'seed_summary', type: 'text', nullable: true })
  seedSummary: string | null;

  @Column({ name: 'continued_from_conversation_id', type: 'uuid', nullable: true })
  continuedFromConversationId: string | null;

  @ManyToOne(() => ConversationEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'continued_from_conversation_id' })
  continuedFrom: ConversationEntity | null;

  @OneToMany(() => MessageEntity, (m) => m.conversation, { cascade: true })
  messages: MessageEntity[];
}
