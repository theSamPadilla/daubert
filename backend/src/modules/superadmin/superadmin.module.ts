import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { OrganizationEntity } from '../../database/entities/organization.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { SuperadminUsersController } from './users/superadmin-users.controller';
import { SuperadminUsersService } from './users/superadmin-users.service';
import { SuperadminCasesController } from './cases/superadmin-cases.controller';
import { SuperadminLabeledEntitiesController } from './labeled-entities/superadmin-labeled-entities.controller';
import { SuperadminOrgsController } from './orgs/superadmin-orgs.controller';
import { SuperadminOrgsService } from './orgs/superadmin-orgs.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    LabeledEntitiesModule,
    TypeOrmModule.forFeature([UserEntity, CaseEntity, OrganizationEntity, OrganizationMemberEntity]),
  ],
  controllers: [
    SuperadminUsersController,
    SuperadminCasesController,
    SuperadminLabeledEntitiesController,
    SuperadminOrgsController,
  ],
  providers: [SuperadminUsersService, SuperadminOrgsService],
})
export class SuperadminModule {}
