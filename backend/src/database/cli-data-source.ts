import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { entities } from './entities';

const isProduction = process.env.NODE_ENV === 'production';

const url = isProduction
  ? process.env.DATABASE_ADMIN_URL
  : process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    isProduction
      ? 'DATABASE_ADMIN_URL is required for production migrations'
      : 'DATABASE_URL is required for development migrations',
  );
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  url,
  entities,
  migrations: ['src/database/migrations/*.ts'],
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  synchronize: false,
});
