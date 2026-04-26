import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../../database/entities/user.entity';
import { CaseEntity } from '../../../database/entities/case.entity';
import { CaseMemberEntity, CaseRole } from '../../../database/entities/case-member.entity';

@Injectable()
export class AdminUsersService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Create a user shell. If `caseId` + `role` are supplied, atomically add the
   * new user to that case. Either both succeed or neither persists.
   */
  async createWithOptionalMembership(input: {
    email: string;
    name: string;
    caseId?: string;
    role?: CaseRole;
  }): Promise<UserEntity> {
    return this.dataSource.transaction(async (manager) => {
      if (input.caseId) {
        const exists = await manager.findOneBy(CaseEntity, { id: input.caseId });
        if (!exists) throw new NotFoundException(`Case ${input.caseId} not found`);
      }

      const user = await manager.save(
        manager.create(UserEntity, { email: input.email, name: input.name }),
      );

      if (input.caseId && input.role) {
        await manager.save(
          manager.create(CaseMemberEntity, {
            caseId: input.caseId,
            userId: user.id,
            role: input.role,
          }),
        );
      }

      return user;
    });
  }
}
