import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';

export enum ProductionType {
  REPORT = 'report',
  CHART = 'chart',
  CHRONOLOGY = 'chronology',
}

@Entity('productions')
export class ProductionEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'varchar' })
  type: ProductionType;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data: Record<string, unknown>;

  @Column({ name: 'case_id' })
  caseId: string;

  @ManyToOne(() => CaseEntity, (c) => c.productions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'case_id' })
  case: CaseEntity;
}
