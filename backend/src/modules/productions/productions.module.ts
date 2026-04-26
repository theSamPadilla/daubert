import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductionEntity } from '../../database/entities/production.entity';
import { ProductionsController } from './productions.controller';
import { ProductionsService } from './productions.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductionEntity]),
    AuthModule,
  ],
  controllers: [ProductionsController],
  providers: [ProductionsService],
  exports: [ProductionsService],
})
export class ProductionsModule {}
