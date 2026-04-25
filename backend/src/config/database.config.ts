import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { entities } from '../database/entities';

export function getDatabaseConfig(): TypeOrmModuleOptions {
  const url = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    type: 'postgres',
    url,
    entities,
    synchronize: !isProduction,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
    migrationsRun: false,
  };
}
