import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeclarantEntity } from '../../database/entities/declarant.entity';
import { AuthModule } from '../auth/auth.module';
import { DeclarantsController } from './declarants.controller';
import { DeclarantsService } from './declarants.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeclarantEntity]), AuthModule],
  controllers: [DeclarantsController],
  providers: [DeclarantsService],
  exports: [DeclarantsService],
})
export class DeclarantsModule {}
