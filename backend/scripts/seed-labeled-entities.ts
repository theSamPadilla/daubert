#!/usr/bin/env ts-node
/**
 * Upsert labeled entities from a JSON file. Matches on name: existing entities
 * get their category/description/metadata replaced and wallets merged.
 * Usage: npm run scripts:seed-labels -- --file scripts/data/demo-ronin-labels.json [--dry-run]
 */
import * as fs from 'fs';
import * as path from 'path';
import { createConnection, parseArgs, colors } from './db-connect';
import {
  EntityCategory,
  LabeledEntityEntity,
} from '../src/database/entities/labeled-entity.entity';

interface LabelSeed {
  name: string;
  category: EntityCategory;
  description?: string;
  wallets: string[];
  metadata?: Record<string, unknown>;
}

const CATEGORIES = new Set<string>(Object.values(EntityCategory));

function loadSeeds(file: string): LabelSeed[] {
  const seeds = JSON.parse(fs.readFileSync(path.resolve(file), 'utf-8')) as LabelSeed[];
  for (const s of seeds) {
    if (!s.name || !CATEGORIES.has(s.category) || !Array.isArray(s.wallets)) {
      throw new Error(`Invalid seed entry: ${JSON.stringify(s)}`);
    }
    s.wallets = s.wallets.map((w) => w.trim().toLowerCase());
  }
  return seeds;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error(colors.red('Usage: --file <path to JSON> [--dry-run]'));
    process.exit(1);
  }
  const dryRun = args['dry-run'] === 'true';
  const seeds = loadSeeds(args.file);

  const ds = await createConnection();
  try {
    const repo = ds.getRepository(LabeledEntityEntity);
    for (const seed of seeds) {
      const existing = await repo.findOne({ where: { name: seed.name } });
      if (existing) {
        existing.category = seed.category;
        existing.description = seed.description ?? null;
        existing.metadata = seed.metadata ?? null;
        existing.wallets = [...new Set([...existing.wallets, ...seed.wallets])];
        if (!dryRun) await repo.save(existing);
        console.log(colors.yellow(`updated  ${seed.name}`));
      } else {
        if (!dryRun) {
          await repo.save(
            repo.create({
              name: seed.name,
              category: seed.category,
              description: seed.description ?? null,
              metadata: seed.metadata ?? null,
              wallets: seed.wallets,
            }),
          );
        }
        console.log(colors.green(`created  ${seed.name}`));
      }
    }
    console.log(colors.bold(`${dryRun ? '[dry run] ' : ''}${seeds.length} entities processed`));
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(colors.red(err.message));
  process.exit(1);
});
