import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { firebaseAdminProvider } from './firebase-admin.provider';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { CaseMemberGuard } from './case-member.guard';
import { IsAdminGuard } from './admin.guard';
import { CaseAccessService } from './case-access.service';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { CaseEntity } from '../../database/entities/case.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CaseMemberEntity, CaseEntity]),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [
    firebaseAdminProvider,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    CaseMemberGuard,
    IsAdminGuard,
    CaseAccessService,
  ],
  exports: [firebaseAdminProvider, CaseMemberGuard, IsAdminGuard, CaseAccessService, TypeOrmModule],
})
export class AuthModule {}
