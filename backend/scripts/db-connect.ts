/**
 * Shared database connection helper for admin scripts.
 * Reads .env.development (or .env.production if NODE_ENV=production),
 * creates a TypeORM DataSource with all entities loaded.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as path from 'path';
import * as fs from 'fs';

function loadEnv(): Record<string, string> {
  const envFile =
    process.env.NODE_ENV === 'production'
      ? '.env.production'
      : '.env.development';
  const envPath = path.resolve(__dirname, '..', envFile);
  const env: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      env[key] = value;
    }
  }

  return { ...env, ...process.env } as Record<string, string>;
}

export async function createConnection(): Promise<DataSource> {
  const env = loadEnv();
  const url = env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL not found in environment');
  }

  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [path.resolve(__dirname, '../src/database/entities/*.entity.ts')],
    synchronize: false,
  });

  await ds.initialize();
  return ds;
}

// Color helpers for script output
export const colors = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args[key] = value;
      if (value !== 'true') i++;
    }
  }
  return args;
}
