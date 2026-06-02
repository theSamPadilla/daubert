import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { OrganizationInviteEntity } from '../../database/entities/organization-invite.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { OrganizationsController } from './organizations.controller';
import { OrgInvitesController } from './org-invites.controller';
import { OrganizationsService } from './organizations.service';
import { OrgInvitesService } from './org-invites.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      OrganizationMemberEntity,
      OrganizationInviteEntity,
      UserEntity,
      CaseEntity,
      CaseMemberEntity,
    ]),
    AuthModule,
    UsersModule,
  ],
  controllers: [OrganizationsController, OrgInvitesController],
  providers: [OrganizationsService, OrgInvitesService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
