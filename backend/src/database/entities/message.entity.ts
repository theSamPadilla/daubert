// backend/src/database/entities/message.entity.ts
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { ConversationEntity } from './conversation.entity';

export type MessageRole = 'user' | 'assistant';

@Entity('messages')
export class MessageEntity extends BaseEntity {
  @Column({ name: 'conversation_id' })
  conversationId: string;

  @ManyToOne(() => ConversationEntity, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: ConversationEntity;

  @Column({ type: 'varchar' })
  role: MessageRole;

  // Stores Anthropic ContentBlock[] verbatim — includes text, tool_use,
  // tool_result, thinking, and compaction blocks.
  @Column({ type: 'jsonb' })
  content: unknown[];
}
