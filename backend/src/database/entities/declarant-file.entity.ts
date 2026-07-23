import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { DeclarantEntity } from './declarant.entity';

export enum DeclarantFileKind {
  CV = 'cv',
  PRIOR_DECLARATION = 'prior_declaration',
}

@Entity('declarant_files')
export class DeclarantFileEntity extends BaseEntity {
  @Index()
  @Column({ name: 'declarant_id' })
  declarantId: string;

  @ManyToOne(() => DeclarantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'declarant_id' })
  declarant: DeclarantEntity;

  @Column({ type: 'varchar' })
  kind: DeclarantFileKind;

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
