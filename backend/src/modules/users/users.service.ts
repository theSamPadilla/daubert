import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';

const SEED_USER = {
  name: 'Sam Padilla',
  email: 'sam@incite.ventures',
};

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repo: Repository<UserEntity>,
  ) {}

  async onModuleInit() {
    const existing = await this.repo.findOneBy({ email: SEED_USER.email });
    if (!existing) {
      await this.repo.save(this.repo.create(SEED_USER));
      console.log('Seeded default user:', SEED_USER.email);
    }
  }

  async getDefaultUser(): Promise<UserEntity> {
    const user = await this.repo.findOneBy({ email: SEED_USER.email });
    if (!user) throw new Error('Default user not found');
    return user;
  }
}
