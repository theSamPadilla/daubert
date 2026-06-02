import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

@Index(['email', 'verified'])
@Entity('otps')
export class OtpEntity extends BaseEntity {
  @Column()
  email: string;

  @Column()
  code: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ default: false })
  verified: boolean;
}
