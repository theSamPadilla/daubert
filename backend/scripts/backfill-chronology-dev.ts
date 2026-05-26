#!/usr/bin/env ts-node
/**
 * Dev-only backfill helper for the MigrateChronologyToSchemaDriven migration.
 *
 * Production schema changes run through `./migrations.sh --prod --run`.
 * On dev, `synchronize: true` keeps the schema in sync but does NOT backfill
 * existing JSONB data. Run this script once against the dev DB to apply the
 * same data transform that the migration's up() applies on prod.
 *
 * Idempotent — skips rows where data.columns already exists and has length > 0.
 *
 * Usage:
 *   npx ts-node backend/scripts/backfill-chronology-dev.ts
 */
import { createConnection, colors } from './db-connect';

async function main() {
  // Hardcoded defaults — must NOT import live code (live types may drift).
  const DEFAULTS = [
    { key: 'source',      label: 'Source',      width: 18, kind: 'link' },
    { key: 'date',        label: 'Date',        width: 14, kind: 'text' },
    { key: 'description', label: 'Description', width: 40, kind: 'text' },
    { key: 'details',     label: 'Details',     width: 28, kind: 'text' },
  ];

  const ds = await createConnection();

  try {
    const rows: Array<{ id: string; data: any }> = await ds.query(
      `SELECT id, data FROM productions WHERE type = 'chronology'`,
    );

    console.log(colors.cyan(`Found ${rows.length} chronology production(s).`));

    let skipped = 0;
    let updated = 0;

    for (const row of rows) {
      const data = (row.data && typeof row.data === 'object') ? row.data : {};
      const nextData: Record<string, any> = { ...data };

      // Idempotency check: skip rows that are already migrated.
      if (Array.isArray(nextData.columns) && nextData.columns.length > 0) {
        skipped++;
        continue;
      }

      // 1. Seed columns, folding in legacy columnWidths if present.
      const legacy = (nextData.columnWidths ?? {}) as Record<string, number>;
      nextData.columns = DEFAULTS.map((c) => ({
        ...c,
        width:
          typeof legacy[c.key] === 'number' &&
          legacy[c.key] >= 5 &&
          legacy[c.key] <= 80
            ? legacy[c.key]
            : c.width,
      }));
      delete nextData.columnWidths;

      // 2. Normalize entries: fold sourceUrl/sourceLabel/source(string) into
      //    entry.source = { url, label }.
      const rawEntries = Array.isArray(nextData.entries) ? nextData.entries : [];
      nextData.entries = rawEntries.map((e: any) => {
        const out = { ...(e ?? {}) };
        const url = typeof out.sourceUrl === 'string' ? out.sourceUrl : null;
        const label = typeof out.sourceLabel === 'string' ? out.sourceLabel : null;
        if (url !== null || label !== null) {
          out.source = { url, label };
          delete out.sourceUrl;
          delete out.sourceLabel;
        } else if (typeof out.source === 'string') {
          out.source = { url: out.source, label: null };
        } else if (
          out.source &&
          typeof out.source === 'object' &&
          'url' in out.source
        ) {
          // Already canonical — no-op.
        } else if (out.source === undefined) {
          out.source = null;
        }
        return out;
      });

      await ds.query(
        `UPDATE productions SET data = $1::jsonb WHERE id = $2`,
        [JSON.stringify(nextData), row.id],
      );
      updated++;
    }

    console.log(colors.green(`Done. Updated: ${updated}, Skipped (already migrated): ${skipped}.`));
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(colors.red(String(e)));
  process.exit(1);
});
