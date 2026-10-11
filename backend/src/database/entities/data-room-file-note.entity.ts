import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';
import { DataRoomFileEntity } from './data-room-file.entity';
import { UserEntity } from './user.entity';

/**
 * Structured notes the AI agent saved after reading a data room file.
 * coverage 'partial' means the read got only part of the file (excerpt, page
 * cap); coverageNote says which part.
 */
export type FileNotes = {
  summary: string;
  keyFacts: string[];
  parties: string[];
  dates: { date: string; event: string }[];
  quotes: { text: string; page?: number }[];
  relevance: string;
  coverage: 'full' | 'partial';
  coverageNote?: string;
};

/** One current notes row per file. */
@Entity('data_room_file_notes')
export class DataRoomFileNoteEntity extends BaseEntity {
  @Index()
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @ManyToOne(() => CaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Index({ unique: true })
  @Column({ name: 'file_id', type: 'uuid' })
  fileId: string;

  @ManyToOne(() => DataRoomFileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file: DataRoomFileEntity;

  @Column({ type: 'jsonb' })
  notes: FileNotes;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @ManyToOne(() => UserEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedByUser: UserEntity | null;

  // No FK: conversations are purged by chat retention, notes outlive them.
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;
}
