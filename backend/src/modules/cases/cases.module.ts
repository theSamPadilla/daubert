import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseEntity } from '../../database/entities/case.entity';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

@Module({
  imports: [TypeOrmModule.forFeature([CaseEntity])],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
