import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';

export type DataRoomStatus = 'active' | 'broken';

@Entity('data_room_connections')
@Unique(['caseId'])
export class DataRoomConnectionEntity extends BaseEntity {
  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;

  @Column({ type: 'varchar', default: 'google_drive' })
  provider: string;

  @Column({ name: 'credentials_cipher', type: 'bytea' })
  credentialsCipher: Buffer;

  @Column({ name: 'credentials_iv', type: 'bytea' })
  credentialsIv: Buffer;

  @Column({ name: 'credentials_auth_tag', type: 'bytea' })
  credentialsAuthTag: Buffer;

  @Column({ name: 'folder_id', type: 'varchar', nullable: true })
  folderId: string | null;

  @Column({ name: 'folder_name', type: 'varchar', nullable: true })
  folderName: string | null;

  @Column({ type: 'varchar', default: 'active' })
  status: DataRoomStatus;
}
