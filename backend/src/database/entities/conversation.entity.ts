// backend/src/database/entities/conversation.entity.ts
import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { MessageEntity } from './message.entity';

@Entity('conversations')
export class ConversationEntity extends BaseEntity {
  @Column({ nullable: true, type: 'varchar' })
  title: string | null;

  @OneToMany(() => MessageEntity, (m) => m.conversation, { cascade: true })
  messages: MessageEntity[];
}
