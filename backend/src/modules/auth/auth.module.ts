import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { firebaseAdminProvider } from './firebase-admin.provider';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { RoleGuard } from './role.guard';
import { OrgRoleGuard } from './org-role.guard';
import { CaseAccessService } from './case-access.service';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { UsersModule } from '../users/users.module';
import { ScriptModule } from '../script/script.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CaseMemberEntity, CaseEntity]),
    UsersModule,
    ScriptModule,
  ],
  controllers: [AuthController],
  providers: [
    firebaseAdminProvider,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    RoleGuard,
    OrgRoleGuard,
    CaseAccessService,
  ],
  exports: [firebaseAdminProvider, RoleGuard, OrgRoleGuard, CaseAccessService, TypeOrmModule],
})
export class AuthModule {}
