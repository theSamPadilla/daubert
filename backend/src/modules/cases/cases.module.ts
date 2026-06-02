import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { OrganizationMemberEntity } from '../../database/entities/organization-member.entity';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CaseEntity, CaseMemberEntity, OrganizationMemberEntity]),
    AuthModule,
    UsersModule,
  ],
  controllers: [CasesController],
  providers: [CasesService],
  exports: [CasesService],
})
export class CasesModule {}
