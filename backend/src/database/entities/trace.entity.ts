import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { InvestigationEntity } from './investigation.entity';

@Entity('traces')
export class TraceEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ nullable: true })
  color: string | null;

  @Column({ default: true })
  visible: boolean;

  @Column({ default: false })
  collapsed: boolean;

  @Column({ type: 'jsonb', default: '{}' })
  data: Record<string, unknown>;

  @Column({ name: 'investigation_id' })
  investigationId: string;

  @ManyToOne(() => InvestigationEntity, (inv) => inv.traces, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'investigation_id' })
  investigation: InvestigationEntity;
}
