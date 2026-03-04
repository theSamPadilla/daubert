import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([CaseEntity]), UsersModule],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
