import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migrates chronology data shape to schema-driven columns.
 *
 *   data.columns:        SEEDED from DEFAULT_COLUMNS, folding in data.columnWidths if present.
 *   data.columnWidths:   REMOVED.
 *   entry.sourceUrl/sourceLabel/source(string): FOLDED into entry.source = { url, label }.
 *
 * WARNING: down() is lossy. Custom columns and their entry data are destroyed
 * on rollback. The migration cannot reconstruct labels/kinds for columns that
 * didn't exist pre-up(). For prod rollback, restore from backup instead.
 */
export class MigrateChronologyToSchemaDriven1779829284023 implements MigrationInterface {
  name = 'MigrateChronologyToSchemaDriven1779829284023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hardcoded defaults — migrations must not import live code (live code may
    // diverge over time and break old migration replay).
    const DEFAULTS = [
      { key: 'source',      label: 'Source',      width: 18, kind: 'link' },
      { key: 'date',        label: 'Date',        width: 14, kind: 'text' },
      { key: 'description', label: 'Description', width: 40, kind: 'text' },
      { key: 'details',     label: 'Details',     width: 28, kind: 'text' },
    ];

    const rows: Array<{ id: string; data: any }> = await queryRunner.query(
      `SELECT id, data FROM productions WHERE type = 'chronology'`,
    );

    for (const row of rows) {
      const data = (row.data && typeof row.data === 'object') ? row.data : {};
      const nextData: Record<string, any> = { ...data };

      // 1. Seed columns if not already present.
      if (!Array.isArray(nextData.columns) || nextData.columns.length === 0) {
        const legacy = (nextData.columnWidths ?? {}) as Record<string, number>;
        nextData.columns = DEFAULTS.map((c) => ({
          ...c,
          width: typeof legacy[c.key] === 'number' && legacy[c.key] >= 5 && legacy[c.key] <= 80
            ? legacy[c.key]
            : c.width,
        }));
      }
      delete nextData.columnWidths;

      // 2. Normalize entries.
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
        } else if (out.source && typeof out.source === 'object' && 'url' in out.source) {
          // Already canonical — coerce url/label to consistent {string|null} shape.
          const c = out.source as { url?: unknown; label?: unknown };
          out.source = {
            url: typeof c.url === 'string' ? c.url : null,
            label: typeof c.label === 'string' ? c.label : null,
          };
        } else if (out.source === undefined) {
          out.source = null;
        }
        return out;
      });

      await queryRunner.query(
        `UPDATE productions SET data = $1::jsonb WHERE id = $2`,
        [JSON.stringify(nextData), row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // LOSSY rollback. See header comment.
    const rows: Array<{ id: string; data: any }> = await queryRunner.query(
      `SELECT id, data FROM productions WHERE type = 'chronology'`,
    );

    for (const row of rows) {
      const data = (row.data && typeof row.data === 'object') ? row.data : {};
      const nextData: Record<string, any> = { ...data };

      // Re-derive columnWidths from columns, then strip columns.
      const columns: Array<{ key: string; width: number }> = Array.isArray(nextData.columns) ? nextData.columns : [];
      const columnWidths: Record<string, number> = {};
      for (const c of columns) {
        if (typeof c.width === 'number') columnWidths[c.key] = c.width;
      }
      nextData.columnWidths = columnWidths;
      delete nextData.columns;

      // Re-flatten source: { url, label } back to sourceUrl + sourceLabel.
      const rawEntries = Array.isArray(nextData.entries) ? nextData.entries : [];
      nextData.entries = rawEntries.map((e: any) => {
        const out = { ...(e ?? {}) };
        if (out.source && typeof out.source === 'object' && 'url' in out.source) {
          if (out.source.url) out.sourceUrl = out.source.url;
          if (out.source.label) out.sourceLabel = out.source.label;
          delete out.source;
        }
        return out;
      });

      await queryRunner.query(
        `UPDATE productions SET data = $1::jsonb WHERE id = $2`,
        [JSON.stringify(nextData), row.id],
      );
    }
  }
}
