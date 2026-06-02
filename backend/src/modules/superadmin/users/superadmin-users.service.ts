import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../../database/entities/user.entity';
import { ADMIN_EMAIL_DOMAIN } from '../../auth/admin.constants';

@Injectable()
export class SuperadminUsersService {
  constructor(private readonly dataSource: DataSource) {}

  async createUserShell(input: { email: string; name: string }): Promise<UserEntity> {
    const email = input.email.trim().toLowerCase();
    const emailDomain = email.split('@')[1];
    const isSuperAdmin = emailDomain === ADMIN_EMAIL_DOMAIN;

    return this.dataSource.transaction(async (manager) => {
      return manager.save(
        manager.create(UserEntity, {
          email,
          name: input.name,
          isSuperAdmin,
        }),
      );
    });
  }
}
