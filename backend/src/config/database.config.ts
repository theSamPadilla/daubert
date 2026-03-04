import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function getDatabaseConfig(): TypeOrmModuleOptions {
  const url = process.env.DATABASE_URL;

  if (url) {
    return {
      type: 'postgres',
      url,
      autoLoadEntities: true,
      synchronize: true,
    };
  }

  // SQLite fallback for quick local dev without Docker
  return {
    type: 'sqlite',
    database: 'daubert.sqlite',
    autoLoadEntities: true,
    synchronize: true,
  };
}
