import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export type DataRoomAction = 'upload' | 'download' | 'delete' | 'agent_read' | 'export';

@Entity('data_room_access_log')
export class DataRoomAccessLogEntity extends BaseEntity {
  @Index()
  @Column({ name: 'case_id' })
  caseId: string;

  @Column({ name: 'file_id', type: 'varchar', nullable: true })
  fileId: string | null;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar' })
  action: DataRoomAction;
}
