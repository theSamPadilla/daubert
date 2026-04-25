import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { MessageEntity } from './message.entity';
import { CaseEntity } from './case.entity';

@Entity('conversations')
export class ConversationEntity extends BaseEntity {
  @Column({ nullable: true, type: 'varchar' })
  title: string | null;

  @Column({ name: 'case_id', nullable: true })
  caseId: string | null;

  @ManyToOne(() => CaseEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @OneToMany(() => MessageEntity, (m) => m.conversation, { cascade: true })
  messages: MessageEntity[];
}
