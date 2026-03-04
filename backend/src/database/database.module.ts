import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDatabaseConfig } from '../config/database.config';

@Module({
  imports: [TypeOrmModule.forRoot(getDatabaseConfig())],
})
export class DatabaseModule {}
