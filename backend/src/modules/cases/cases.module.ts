import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CaseMemberEntity } from '../../database/entities/case-member.entity';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CaseEntity, CaseMemberEntity]),
    AuthModule,
  ],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
