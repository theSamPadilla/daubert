// backend/src/database/entities/conversation.entity.ts
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { MessageEntity } from './message.entity';

@Entity('conversations')
export class ConversationEntity extends BaseEntity {
  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, (c) => c.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Column({ nullable: true, type: 'varchar' })
  title: string | null;

  @OneToMany(() => MessageEntity, (m) => m.conversation, { cascade: true })
  messages: MessageEntity[];
}
