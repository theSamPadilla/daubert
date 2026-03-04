import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CaseEntity } from './case.entity';

@Entity('users')
export class UserEntity extends BaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @OneToMany(() => CaseEntity, (c) => c.user)
  cases: CaseEntity[];
}
