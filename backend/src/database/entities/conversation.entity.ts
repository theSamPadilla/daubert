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

  @OneToMany(() => MessageEntity, (m) => m.conversation, { cascade: true })
  messages: MessageEntity[];
}
