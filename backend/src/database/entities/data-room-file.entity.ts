import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('data_room_files')
export class DataRoomFileEntity extends BaseEntity {
  @Index()
  @Column({ name: 'case_id' })
  caseId: string;

  @Column()
  name: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column({ type: 'bigint' }) // bytes; TypeORM returns bigint as string
  size: string;

  @Index({ unique: true })
  @Column({ name: 'object_key' })
  objectKey: string;

  @Column({ name: 'uploaded_by_user_id' })
  uploadedByUserId: string;
}
