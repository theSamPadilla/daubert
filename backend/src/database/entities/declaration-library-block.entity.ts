import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { OrganizationEntity } from './organization.entity';

export enum DeclarationLibraryBlockKind {
  DECLARANT_PROFILE = 'declarant_profile',
  BOILERPLATE = 'boilerplate',
}

@Entity('declaration_library_blocks')
export class DeclarationLibraryBlockEntity extends BaseEntity {
  @Column({ type: 'varchar' })
  kind: DeclarationLibraryBlockKind;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  content: Record<string, unknown>;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: OrganizationEntity;
}
