import { Entity, Column, Unique, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { OrganizationEntity } from './organization.entity';
import { UserEntity } from './user.entity';

@Entity('monthly_usage')
@Unique(['orgId', 'userId', 'period', 'model'])
export class MonthlyUsageEntity extends BaseEntity {
  @Column({ name: 'org_id', type: 'uuid' })
  orgId: string;

  @ManyToOne(() => OrganizationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'org_id' })
  organization: OrganizationEntity;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ name: 'call_count', type: 'bigint', default: 0 })
  callCount: string; // TypeORM deserializes bigint to string

  @Column({ name: 'input_tokens', type: 'bigint', default: 0 })
  inputTokens: string;

  @Column({ name: 'output_tokens', type: 'bigint', default: 0 })
  outputTokens: string;

  @Column({ name: 'cache_read_input_tokens', type: 'bigint', default: 0 })
  cacheReadInputTokens: string;

  @Column({ name: 'cache_creation_5m_input_tokens', type: 'bigint', default: 0 })
  cacheCreation5mInputTokens: string;

  @Column({ name: 'cache_creation_1h_input_tokens', type: 'bigint', default: 0 })
  cacheCreation1hInputTokens: string;
}
