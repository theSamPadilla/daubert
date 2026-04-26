import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CasesModule } from '../cases/cases.module';
import { LabeledEntitiesModule } from '../labeled-entities/labeled-entities.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminCasesController } from './cases/admin-cases.controller';
import { AdminLabeledEntitiesController } from './labeled-entities/admin-labeled-entities.controller';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    CasesModule,
    LabeledEntitiesModule,
    TypeOrmModule.forFeature([UserEntity, CaseEntity, CaseMemberEntity]),
  ],
  controllers: [AdminUsersController, AdminCasesController, AdminLabeledEntitiesController],
  providers: [AdminUsersService],
})
export class AdminModule {}
