import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('data_room_folders')
@Index(['caseId', 'parentFolderId'])
export class DataRoomFolderEntity extends BaseEntity {
  @Column({ name: 'case_id' })
  caseId: string;

  @Column({ name: 'parent_folder_id', type: 'varchar', nullable: true }) // null = root
  parentFolderId: string | null;

  @Column()
  name: string;

  @Column({ name: 'created_by_user_id' })
  createdByUserId: string;
}
