# Chronology Custom Columns Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make chronology columns schema-driven so agents and users can add, rename, remove, and reorder columns beyond the fixed `source / date / description / details` set.

**Architecture:** Chronology `data` gains a `columns: ColumnDef[]` array — the single source of truth for which columns exist, their order, labels, widths, and rendering kind. Entries become **uniformly keyed**: every column value lives at `entry[column.key]`. The built-in `source` column has `kind: 'link'` and stores `{ url, label } | null` at `entry.source`. All other columns (custom and default `date`/`description`/`details`) have `kind: 'text'` and store a string at `entry[key]`. Row-level metadata (`highlight`, `sourceTraceId`, `sourceEdgeId`) stays flat on the entry — it is not column data. A TypeORM migration both backfills `data.columns` and rewrites every entry, folding legacy `sourceUrl`/`sourceLabel`/`source` flat fields into the new `entry.source = { url, label }` shape and folding `data.columnWidths` into the seeded column widths. New atomic ops (`chronology_add_column`, `chronology_remove_column`, `chronology_update_column`, `chronology_reorder_columns`) mutate the column schema; `chronology_set_column_widths` stays as the resize-drag fast path. `chronology_append` is taught to normalize legacy entry shapes inbound so agents that haven't been retrained keep working. The frontend `ChronologyTable` reads `data.columns`, renders dynamic `<colgroup>` / headers / cells, generalizes drag-resize to N-1 handles, and exposes UI affordances for add/rename/remove column.

**Tech Stack:** NestJS, TypeORM, Postgres (JSONB), Next.js 14, React, Tailwind. Existing op-validation pattern in `productions.service.ts` (parse → apply, discriminated union).

---

## Atomized Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `backend/src/modules/productions/chronology-schema.ts` | Create | `ColumnDef` + `ChronologyData` + `ChronologyEntry` types, `DEFAULT_COLUMNS`, `RESERVED_KEYS`, `seedChronologyData()`, `normalizeEntry()` (legacy-shape compat), `slugifyColumnLabel()` — single source of truth shared by service + export |
| 2 | `backend/src/modules/productions/chronology-schema.spec.ts` | Create | Unit tests for the schema module (defaults, seeding, normalization, slugify, reserved-key check) |
| 3 | `backend/src/modules/productions/productions.service.ts` | Modify | Four new ops (`add_column`, `remove_column`, `update_column`, `reorder_columns`); generalize `set_column_widths` to validate against `data.columns`; teach `chronology_append` and `chronology_replace` to normalize entries; seed defaults on create |
| 4 | `backend/src/modules/productions/productions.service.spec.ts` | Modify | TDD coverage for every new op + edited op + creation seeding + sequential-op edge cases |
| 5 | `backend/src/database/migrations/<ts>-MigrateChronologyToSchemaDriven.ts` | Create | Two-phase one-shot: (a) backfill `data.columns` from `DEFAULT_COLUMNS` + legacy `data.columnWidths`; (b) rewrite each entry to fold `sourceUrl` / `sourceLabel` / legacy `source` string into `entry.source = { url, label }`; strip `data.columnWidths` |
| 6 | `backend/src/modules/export/templates/chronology.ts` | Modify | HTML body + CSV export iterate `data.columns`; link cell renders from `entry.source.{url,label}`; CSV expands the link column into URL+Label pair |
| 7 | `backend/src/modules/ai/tools/tool-definitions.ts` | Modify | Update `CREATE_PRODUCTION_TOOL.data` + `UPDATE_PRODUCTION_TOOL` op list. Document new entry shape (`source: { url, label }`) and new ops |
| 8 | `backend/src/skills/productions.md` | Modify | Update chronology section: new entry shape, new ops, "add a column for X" examples |
| 9 | `backend/src/prompts/investigator.ts` | Modify | Update inline chronology guidance (lines ~46–48) to match new entry shape and reflect that the agent can shape its own columns |
| 10 | `frontend/src/lib/chronologySchema.ts` | Create | Frontend mirror of `ColumnDef` + `DEFAULT_COLUMNS` + `getColumns()` + `RESERVED_KEYS` + `slugifyColumnLabel()` — replaces the duplicated `ColumnWidths` type |
| 11 | `frontend/src/components/Productions/ChronologyTable.tsx` | Modify | Render dynamic `<colgroup>` + headers + cells; generalize drag-resize to N columns; click-to-rename headers; per-header remove control; "+" affordance lives **outside** the `<table>` (below the header bar) so colgroup math stays clean |
| 12 | `frontend/src/components/Productions/ProductionViewer.tsx` | Modify | New callbacks for `chronology_add_column` / `remove_column` / `update_column`; change `handleColumnResize` signature to `Record<string, number>`; surface errors via inline state, not just `console.error` |
| 13 | `frontend/src/components/Workspace/NewPrimaryModal.tsx` | Modify (small) | Leave as-is — backend seeding handles the empty-entries case. Only touch to drop `title` field if grep confirms it's unused |
| 14 | `docs/plans/2026-05-26-chronology-custom-columns.md` | Create | This file |

### What changes (UX and DX)

**For the user (UX):**
- Chronology table is no longer locked to 4 columns. The agent can introduce columns like `Amount`, `Counterparty`, `Exhibit #`, `Tag` per investigation.
- A "+ Add column" affordance below the header lets the user add a custom text column on demand. Header labels are click-to-rename. A hover-revealed "×" on each non-source header removes it (data preserved, just hidden).
- Existing chronologies look identical after migration — same 4 columns, same labels, same widths.
- PDF/HTML/CSV export reflects whatever columns the chronology currently has. **Note:** CSV column order now matches the visual table order (Source first, then Date, …) — previously it was Date-first. Heads-up if anyone has a CSV ingest pipeline.

**For the agent / DX:**
- New ops let the agent shape columns directly: add `Amount` when transfers matter, drop `Details` when always empty, rename `Description` → `Event`. All atomic, token-bounded.
- Entry shape becomes uniform: `entries[i][columnKey] = value`. The source column's value is `{ url, label }` (because `kind: 'link'`); every other column's value is a string. Legacy agent input (`sourceUrl`, `sourceLabel`, top-level `source` as string) is silently normalized on `chronology_append` / `chronology_replace`.
- The three `ColumnWidths` duplications (service, export, frontend) collapse to two source-of-truths (one backend module, one frontend mirror).

### Architectural call-outs

1. **Two source-of-truth files only.** `backend/src/modules/productions/chronology-schema.ts` (canonical) and `frontend/src/lib/chronologySchema.ts` (mirror with a "keep in sync" header comment). Never let the export template or any component re-declare `ColumnDef` / `DEFAULT_COLUMNS`.
2. **`source` is the only `kind: 'link'` column (Phase 1).** `chronology_add_column` rejects `kind !== 'text'`. If the user ever needs a second link column we generalize then. Custom columns are text-only.
3. **Column key is immutable post-creation.** Rename = `label` only. `chronology_update_column` rejects `patch.key` and `patch.kind`. Changing the key would require rewriting every entry; out of scope.
4. **`chronology_set_column_widths` stays as its own op.** Don't fold into `update_column`. Drag-resize is high-frequency and writes 2 keys per gesture; the dedicated op matches the existing UI contract and keeps the fast path simple.
5. **Migration `down()` is lossy by design.** After rollback, custom columns and their entry data are destroyed; orphaned entry keys (for columns removed but not migrated back) remain in JSONB but are unreachable. Documented in the migration's header comment. There is no engineering workaround — restore from backup if rollback is needed in prod.
6. **Dev migration discipline.** Project CLAUDE.md says: "if a schema change requires a data backfill that `synchronize` can't do, apply a one-shot SQL block on dev that mirrors the migration's `up()` — but the migration file itself is still the source of truth for prod." Task 6 includes a small Node helper script (committed but only run manually) for the dev backfill. Prod runs `./migrations.sh --prod --run` as always — and **the user runs that, not us**.
7. **`columns.length >= 1` is an invariant.** All ops that mutate the columns array enforce it. Tested explicitly.
8. **No git commits in this plan.** Each task ends with `git status`. The user reviews and commits.

### Out of scope (Phase 2)

- Drag-to-reorder column headers in the UI (backend op exists; UI deferred).
- Column kinds beyond `text` and `link` (e.g. `number`, `date`, `select`).
- Per-column formatting / validation (e.g. enforce `YYYY-MM-DD` on a date column).
- Multi-link columns.

---

## Task 0: Pre-flight

**Files:** read-only.

**Step 1: Confirm rules.**

- Read `/Users/Sam/Work/Incite/dev/daubert/CLAUDE.md`.
- Confirm: no commits unless asked. No `git add`/`git commit` in this plan. Each task ends with `git status`.
- Confirm: migrations always via `./migrations.sh --dev --generate <Name>` for generation; user runs `./migrations.sh --prod --run`.

**Step 2: Read existing op pattern.**

`backend/src/modules/productions/productions.service.ts:100-232` — the `parseOp` / `applyOp` discriminated-union pattern is the template the new ops follow. Errors are thrown with the prefix `ops[i] (op_name):`.

**Step 3: Run baseline tests so we know the green starting point.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/backend && npx jest productions
```
Expected: all pass.

---

## Task 1: Backend — `chronology-schema.ts` (types, defaults, normalization)

**Files:**
- Create: `backend/src/modules/productions/chronology-schema.ts`
- Create: `backend/src/modules/productions/chronology-schema.spec.ts`

**Step 1: Write the failing tests.**

```ts
// backend/src/modules/productions/chronology-schema.spec.ts
import {
  DEFAULT_COLUMNS,
  RESERVED_KEYS,
  seedChronologyData,
  normalizeEntry,
  slugifyColumnLabel,
  isReservedColumnKey,
} from './chronology-schema';

describe('chronology-schema', () => {
  describe('DEFAULT_COLUMNS', () => {
    it('has 4 columns: source, date, description, details', () => {
      expect(DEFAULT_COLUMNS.map((c) => c.key)).toEqual([
        'source', 'date', 'description', 'details',
      ]);
    });
    it('source is kind=link; others kind=text', () => {
      expect(DEFAULT_COLUMNS[0]).toMatchObject({ key: 'source', kind: 'link' });
      DEFAULT_COLUMNS.slice(1).forEach((c) => expect(c.kind).toBe('text'));
    });
    it('widths sum to 100', () => {
      expect(DEFAULT_COLUMNS.reduce((s, c) => s + c.width, 0)).toBe(100);
    });
  });

  describe('RESERVED_KEYS', () => {
    it('reserves system metadata fields', () => {
      expect(isReservedColumnKey('highlight')).toBe(true);
      expect(isReservedColumnKey('sourceTraceId')).toBe(true);
      expect(isReservedColumnKey('sourceEdgeId')).toBe(true);
    });
    it('reserves the built-in source column key', () => {
      expect(isReservedColumnKey('source')).toBe(true);
    });
    it('allows arbitrary custom keys, including date/description/details', () => {
      // date/description/details are default-column keys, not reserved — they're
      // just data keys like any other; if removed and re-added as custom text
      // columns, that's fine.
      expect(isReservedColumnKey('date')).toBe(false);
      expect(isReservedColumnKey('description')).toBe(false);
      expect(isReservedColumnKey('details')).toBe(false);
      expect(isReservedColumnKey('amount')).toBe(false);
      expect(isReservedColumnKey('exhibit')).toBe(false);
    });
  });

  describe('seedChronologyData', () => {
    it('adds default columns when missing', () => {
      const out = seedChronologyData({ entries: [] });
      expect(out.columns).toEqual(DEFAULT_COLUMNS);
    });
    it('preserves caller-provided columns', () => {
      const cols = [{ key: 'a', label: 'A', width: 100, kind: 'text' as const }];
      const out = seedChronologyData({ entries: [], columns: cols });
      expect(out.columns).toEqual(cols);
    });
    it('ensures entries array exists', () => {
      const out = seedChronologyData({});
      expect(out.entries).toEqual([]);
    });
    it('folds legacy columnWidths into seeded columns and drops it', () => {
      const out = seedChronologyData({
        entries: [],
        columnWidths: { source: 22, date: 10 },
      });
      const byKey = Object.fromEntries(out.columns!.map((c) => [c.key, c.width]));
      expect(byKey.source).toBe(22);
      expect(byKey.date).toBe(10);
      expect((out as any).columnWidths).toBeUndefined();
    });
    it('normalizes seeded entries through normalizeEntry', () => {
      const out = seedChronologyData({
        entries: [{ sourceUrl: 'https://x', sourceLabel: 'X', date: '2025-01-01', description: 'd' }],
      });
      expect(out.entries[0]).toEqual({
        source: { url: 'https://x', label: 'X' },
        date: '2025-01-01',
        description: 'd',
      });
    });
  });

  describe('normalizeEntry', () => {
    it('folds sourceUrl + sourceLabel into source: { url, label }', () => {
      const out = normalizeEntry({ sourceUrl: 'https://x', sourceLabel: 'X', date: '2025-01-01' });
      expect(out.source).toEqual({ url: 'https://x', label: 'X' });
      expect((out as any).sourceUrl).toBeUndefined();
      expect((out as any).sourceLabel).toBeUndefined();
    });
    it('folds legacy top-level source (string) into source: { url, label: null }', () => {
      const out = normalizeEntry({ source: 'https://x', date: '2025-01-01' } as any);
      expect(out.source).toEqual({ url: 'https://x', label: null });
    });
    it('passes through already-canonical source: { url, label }', () => {
      const out = normalizeEntry({ source: { url: 'https://x', label: 'X' }, date: '2025-01-01' });
      expect(out.source).toEqual({ url: 'https://x', label: 'X' });
    });
    it('sets source to null when neither sourceUrl nor source provided', () => {
      const out = normalizeEntry({ date: '2025-01-01', description: 'd' });
      expect(out.source).toBeNull();
    });
    it('preserves arbitrary custom keys', () => {
      const out = normalizeEntry({ date: '2025-01-01', amount: '$1,200', exhibit: 'A-12' });
      expect(out.amount).toBe('$1,200');
      expect(out.exhibit).toBe('A-12');
    });
    it('preserves highlight and graph-reference metadata', () => {
      const out = normalizeEntry({
        date: '2025-01-01',
        highlight: 'green',
        sourceTraceId: 't-1',
        sourceEdgeId: 'e-1',
      } as any);
      expect(out.highlight).toBe('green');
      expect((out as any).sourceTraceId).toBe('t-1');
      expect((out as any).sourceEdgeId).toBe('e-1');
    });
    it('is idempotent', () => {
      const once = normalizeEntry({ sourceUrl: 'https://x', sourceLabel: 'X', date: '2025-01-01' });
      const twice = normalizeEntry(once);
      expect(twice).toEqual(once);
    });
  });

  describe('slugifyColumnLabel', () => {
    it('produces lowercase snake-ish keys', () => {
      expect(slugifyColumnLabel('Amount (USD)')).toBe('amount_usd');
      expect(slugifyColumnLabel('   Tag   ')).toBe('tag');
    });
    it('throws on empty/garbage input', () => {
      expect(() => slugifyColumnLabel('!!!')).toThrow(/non-empty/i);
      expect(() => slugifyColumnLabel('   ')).toThrow(/non-empty/i);
    });
  });
});
```

**Step 2: Run — expect failure (module not found).**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/backend && npx jest chronology-schema.spec.ts
```

**Step 3: Implement.**

```ts
// backend/src/modules/productions/chronology-schema.ts

export type ColumnKind = 'text' | 'link';

export interface ColumnDef {
  key: string;       // stable identifier; immutable after creation
  label: string;     // header display text
  width: number;     // percent of table width, 5–80
  kind: ColumnKind;  // 'text' (string value) | 'link' (object value, source column only)
}

export interface ChronologyLinkValue {
  url: string | null;
  label: string | null;
}

// Entries carry column-bound values at `entry[column.key]`. The source column's
// value is a `ChronologyLinkValue`; every other column's value is a string.
// Row-level metadata (not column data) lives at well-known flat keys.
export interface ChronologyEntry {
  // System metadata (not column-bound):
  highlight?: string | null;
  sourceTraceId?: string;
  sourceEdgeId?: string;
  // Column-bound values, keyed by column key. Source is special-cased.
  source?: ChronologyLinkValue | null;
  [columnKey: string]: unknown;
}

export interface ChronologyData {
  entries: ChronologyEntry[];
  columns?: ColumnDef[];
  // Legacy. Migration folds into `columns[*].width` and removes.
  columnWidths?: Record<string, number>;
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'source',      label: 'Source',      width: 18, kind: 'link' },
  { key: 'date',        label: 'Date',        width: 14, kind: 'text' },
  { key: 'description', label: 'Description', width: 40, kind: 'text' },
  { key: 'details',     label: 'Details',     width: 28, kind: 'text' },
];

// Keys reserved from use as CUSTOM column keys (via chronology_add_column).
// The seeded source column uses `source` directly — seeding bypasses the
// reserved check. All other defaults (`date`, `description`, `details`) are
// just data keys; users can remove and re-add them as text columns.
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'highlight',
  'sourceTraceId',
  'sourceEdgeId',
  'source',
]);

export function isReservedColumnKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

export function slugifyColumnLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) {
    throw new Error('Column label must produce a non-empty slug (alphanumeric required)');
  }
  return slug;
}

// Fold legacy entry-shape variants into canonical form. Idempotent.
//   sourceUrl + sourceLabel   →  source: { url, label }
//   source: <string>          →  source: { url: <string>, label: null }
//   source: { url, label }    →  unchanged
//   missing                   →  source: null
export function normalizeEntry(raw: Record<string, unknown>): ChronologyEntry {
  const out: ChronologyEntry = { ...raw };

  const legacyUrl = typeof raw.sourceUrl === 'string' ? raw.sourceUrl : null;
  const legacyLabel = typeof raw.sourceLabel === 'string' ? raw.sourceLabel : null;
  const cur = raw.source;

  if (legacyUrl !== null || legacyLabel !== null) {
    out.source = { url: legacyUrl, label: legacyLabel };
    delete (out as any).sourceUrl;
    delete (out as any).sourceLabel;
  } else if (typeof cur === 'string') {
    out.source = { url: cur, label: null };
  } else if (cur && typeof cur === 'object' && 'url' in (cur as object)) {
    // Already canonical.
    const c = cur as { url?: unknown; label?: unknown };
    out.source = {
      url: typeof c.url === 'string' ? c.url : null,
      label: typeof c.label === 'string' ? c.label : null,
    };
  } else if (out.source === undefined) {
    out.source = null;
  }

  return out;
}

// Normalize whatever shape the caller (agent or UI) sent into canonical data.
export function seedChronologyData(
  input: Record<string, unknown> | undefined,
): ChronologyData {
  const src = (input ?? {}) as Partial<ChronologyData>;
  const rawEntries = Array.isArray(src.entries) ? src.entries : [];
  const entries = rawEntries.map((e) => normalizeEntry(e as Record<string, unknown>));

  let columns: ColumnDef[];
  if (Array.isArray(src.columns) && src.columns.length > 0) {
    columns = src.columns.map((c) => ({ ...c }));
  } else {
    columns = DEFAULT_COLUMNS.map((c) => ({ ...c }));
  }

  const legacy = src.columnWidths;
  if (legacy && typeof legacy === 'object') {
    for (const c of columns) {
      const v = (legacy as Record<string, unknown>)[c.key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 5 && v <= 80) c.width = v;
    }
  }

  return { entries, columns };
}
```

**Step 4: Run — expect PASS (all describes green).**

**Step 5: `git status` checkpoint.**

---

## Task 2: Backend — generalize `chronology_set_column_widths` to validate against `data.columns`

**Files:**
- Modify: `productions.service.ts` (op type + parseOp + applyOp; drop the local `ColumnWidths` type)
- Modify: `productions.service.spec.ts`

**Step 1: Failing tests** (add to spec):

```ts
describe('chronology_set_column_widths (schema-driven)', () => {
  it('updates width on matching column in data.columns', async () => {
    const prod = await seedProd(); // helper that creates a seeded chronology
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_set_column_widths', widths: { source: 30 } }],
    }, principal);
    const cols = (out.data as any).columns;
    expect(cols.find((c: any) => c.key === 'source').width).toBe(30);
    expect(cols.find((c: any) => c.key === 'date').width).toBe(14);
  });

  it('handles multiple widths in one op', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_set_column_widths', widths: { source: 25, date: 20 } }],
    }, principal);
    const cols = (out.data as any).columns;
    expect(cols.find((c: any) => c.key === 'source').width).toBe(25);
    expect(cols.find((c: any) => c.key === 'date').width).toBe(20);
  });

  it('rejects unknown column key', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_set_column_widths', widths: { nonexistent: 10 } }],
    }, principal)).rejects.toThrow(/unknown column key/i);
  });

  it('rejects out-of-range widths', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_set_column_widths', widths: { source: 200 } }],
    }, principal)).rejects.toThrow(/between 5 and 80/);
  });

  it('strips legacy data.columnWidths if present', async () => {
    const prod = await seedProd();
    // Inject a legacy field via direct save (simulating un-migrated row):
    prod.data = { ...(prod.data as object), columnWidths: { source: 50 } } as any;
    await repo.save(prod);
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_set_column_widths', widths: { source: 25 } }],
    }, principal);
    expect((out.data as any).columnWidths).toBeUndefined();
  });
});
```

(`seedProd` helper: factor out of existing tests; creates a chronology and calls `seedChronologyData` to ensure `data.columns` is present.)

**Step 2: Run — expect FAIL.**

**Step 3: Implement.**

In `productions.service.ts`:

- Delete the local `ColumnWidths` type (lines 15–20).
- `import { ColumnDef, ChronologyEntry, seedChronologyData, normalizeEntry, isReservedColumnKey } from './chronology-schema';`
- Update `Op` union:
  ```ts
  | { op: 'chronology_set_column_widths'; widths: Record<string, number> }
  ```
- `parseOp` for `chronology_set_column_widths`:
  ```ts
  case 'chronology_set_column_widths': {
    if (raw.widths === null || typeof raw.widths !== 'object') {
      throw new BadRequestException(`ops[${i}] (chronology_set_column_widths): \`widths\` must be an object`);
    }
    const widths: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.widths as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 5 || v > 80) {
        throw new BadRequestException(`ops[${i}] (chronology_set_column_widths): widths.${k} must be a number between 5 and 80`);
      }
      widths[k] = v;
    }
    return { op: 'chronology_set_column_widths', widths };
  }
  ```
- `applyOp`:
  ```ts
  case 'chronology_set_column_widths': {
    const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
    const next = columns.map((c) => ({ ...c }));
    for (const [key, width] of Object.entries(op.widths)) {
      const idx = next.findIndex((c) => c.key === key);
      if (idx < 0) {
        throw new BadRequestException(`ops[${i}] (chronology_set_column_widths): unknown column key "${key}"`);
      }
      next[idx].width = width;
    }
    const out: Record<string, unknown> = { ...data, columns: next };
    delete out.columnWidths;
    return out;
  }
  ```

**Step 4: Run — expect PASS.**

**Step 5: Full spec run — confirm no regressions in other ops.**

```bash
npx jest productions.service.spec.ts
```

**Step 6: `git status` checkpoint.**

---

## Task 3: Backend — teach `chronology_append` and `chronology_replace` to normalize entries

**Why:** agents that haven't been retrained will keep sending `{ sourceUrl, sourceLabel, ... }`. The migration handles existing data; this handles future agent calls.

**Step 1: Failing tests.**

```ts
describe('chronology_append (entry normalization)', () => {
  it('normalizes legacy sourceUrl + sourceLabel into entry.source', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_append', entries: [
        { sourceUrl: 'https://x', sourceLabel: 'X', date: '2025-01-01', description: 'd' },
      ]}],
    }, principal);
    const e = (out.data as any).entries[0];
    expect(e.source).toEqual({ url: 'https://x', label: 'X' });
    expect(e.sourceUrl).toBeUndefined();
    expect(e.sourceLabel).toBeUndefined();
  });

  it('preserves custom column keys (orphan-tolerant)', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_append', entries: [
        { date: '2025-01-01', description: 'd', notInColumns: 'orphan ok' },
      ]}],
    }, principal);
    expect((out.data as any).entries[0].notInColumns).toBe('orphan ok');
  });

  it('sets source: null when entry has no source info', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_append', entries: [
        { date: '2025-01-01', description: 'd' },
      ]}],
    }, principal);
    expect((out.data as any).entries[0].source).toBeNull();
  });
});

describe('chronology_replace (entry normalization)', () => {
  it('normalizes the replacement entry', async () => {
    const prod = await seedProd({
      entries: [{ source: { url: 'https://a', label: 'A' }, date: '2025-01-01', description: 'old' }],
    });
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_replace', index: 0, entry: {
        sourceUrl: 'https://b', sourceLabel: 'B', date: '2025-02-01', description: 'new',
      }}],
    }, principal);
    expect((out.data as any).entries[0].source).toEqual({ url: 'https://b', label: 'B' });
  });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement.**

In `applyOp` case `chronology_append`:
```ts
case 'chronology_append':
  return { ...data, entries: [...entries, ...op.entries.map((e) => normalizeEntry(e))] };
```

In `applyOp` case `chronology_replace`:
```ts
case 'chronology_replace': {
  if (op.index >= entries.length) {
    throw new BadRequestException(`ops[${i}] (chronology_replace): index ${op.index} out of bounds (length=${entries.length})`);
  }
  entries[op.index] = normalizeEntry(op.entry as Record<string, unknown>);
  return { ...data, entries };
}
```

**Step 4: Run — expect PASS.**

**Step 5: `git status` checkpoint.**

---

## Task 4: Backend — `chronology_add_column` op

**Step 1: Failing tests.**

```ts
describe('chronology_add_column', () => {
  it('appends a column at end when index omitted', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, { ops: [{
      op: 'chronology_add_column',
      column: { key: 'amount', label: 'Amount (USD)', width: 12, kind: 'text' },
    }]}, principal);
    const cols = (out.data as any).columns;
    expect(cols[cols.length - 1]).toEqual({ key: 'amount', label: 'Amount (USD)', width: 12, kind: 'text' });
  });

  it('inserts at the given index', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, { ops: [{
      op: 'chronology_add_column',
      column: { key: 'amount', label: 'Amount', width: 10, kind: 'text' },
      index: 1,
    }]}, principal);
    expect((out.data as any).columns[1].key).toBe('amount');
  });

  it('rejects duplicate keys', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, { ops: [{
      op: 'chronology_add_column',
      column: { key: 'date', label: 'Date2', width: 10, kind: 'text' },
    }]}, principal)).rejects.toThrow(/duplicate column key/i);
  });

  it('rejects reserved keys', async () => {
    const prod = await seedProd();
    for (const k of ['highlight', 'sourceTraceId', 'sourceEdgeId', 'source']) {
      await expect(service.update(prod.id, { ops: [{
        op: 'chronology_add_column',
        column: { key: k, label: 'X', width: 10, kind: 'text' },
      }]}, principal)).rejects.toThrow(/reserved column key/i);
    }
  });

  it('rejects kind="link" (custom columns are text-only)', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, { ops: [{
      op: 'chronology_add_column',
      column: { key: 'extra', label: 'Extra', width: 10, kind: 'link' },
    }]}, principal)).rejects.toThrow(/kind must be "text"/);
  });

  it('rejects width outside 5–80', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, { ops: [{
      op: 'chronology_add_column',
      column: { key: 'x', label: 'X', width: 1, kind: 'text' },
    }]}, principal)).rejects.toThrow(/between 5 and 80/);
  });

  it('rejects index past end', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, { ops: [{
      op: 'chronology_add_column',
      column: { key: 'x', label: 'X', width: 10, kind: 'text' },
      index: 99,
    }]}, principal)).rejects.toThrow(/out of bounds/i);
  });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement.**

Extend `Op`:
```ts
| { op: 'chronology_add_column'; column: ColumnDef; index?: number }
```

`parseOp`:
```ts
case 'chronology_add_column': {
  const col = raw.column;
  if (col === null || typeof col !== 'object') {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): \`column\` must be an object`);
  }
  const c = col as Record<string, unknown>;
  if (typeof c.key !== 'string' || !c.key.trim()) {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): column.key must be a non-empty string`);
  }
  if (isReservedColumnKey(c.key)) {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): "${c.key}" is a reserved column key`);
  }
  if (typeof c.label !== 'string' || !c.label.trim()) {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): column.label must be a non-empty string`);
  }
  if (typeof c.width !== 'number' || !Number.isFinite(c.width) || c.width < 5 || c.width > 80) {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): column.width must be a number between 5 and 80`);
  }
  if (c.kind !== 'text') {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): column.kind must be "text" (link reserved for built-in source column)`);
  }
  let index: number | undefined;
  if (raw.index !== undefined) {
    if (typeof raw.index !== 'number' || !Number.isInteger(raw.index) || raw.index < 0) {
      throw new BadRequestException(`ops[${i}] (chronology_add_column): \`index\` must be a non-negative integer`);
    }
    index = raw.index;
  }
  return {
    op: 'chronology_add_column',
    column: { key: c.key, label: c.label, width: c.width, kind: 'text' },
    index,
  };
}
```

`applyOp`:
```ts
case 'chronology_add_column': {
  const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
  if (columns.some((c) => c.key === op.column.key)) {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): duplicate column key "${op.column.key}"`);
  }
  const insertAt = op.index ?? columns.length;
  if (insertAt > columns.length) {
    throw new BadRequestException(`ops[${i}] (chronology_add_column): index ${insertAt} out of bounds (length=${columns.length})`);
  }
  columns.splice(insertAt, 0, op.column);
  return { ...data, columns };
}
```

**Step 4: Run — expect PASS.**

**Step 5: `git status` checkpoint.**

---

## Task 5: Backend — `chronology_remove_column`, `chronology_update_column`, `chronology_reorder_columns`

**Step 1: Failing tests.**

```ts
describe('chronology_remove_column', () => {
  it('removes the matching column by key', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_remove_column', key: 'details' }],
    }, principal);
    expect((out.data as any).columns.find((c: any) => c.key === 'details')).toBeUndefined();
  });

  it('rejects unknown key', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_remove_column', key: 'nope' }],
    }, principal)).rejects.toThrow(/unknown column key/i);
  });

  it('rejects removing the last remaining column', async () => {
    const prod = await seedProd({
      columns: [{ key: 'only', label: 'Only', width: 100, kind: 'text' }],
    });
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_remove_column', key: 'only' }],
    }, principal)).rejects.toThrow(/at least one column/i);
  });

  it('leaves orphaned entry values intact', async () => {
    const prod = await seedProd({
      entries: [{ date: '2025-01-01', description: 'x', details: 'orphan me' }],
    });
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_remove_column', key: 'details' }],
    }, principal);
    expect((out.data as any).entries[0].details).toBe('orphan me');
  });
});

describe('chronology_update_column', () => {
  it('renames the label', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_update_column', key: 'description', patch: { label: 'Event' } }],
    }, principal);
    expect((out.data as any).columns.find((c: any) => c.key === 'description').label).toBe('Event');
  });

  it('rejects changing key', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_update_column', key: 'description', patch: { key: 'desc' } }],
    }, principal)).rejects.toThrow(/cannot change column key/i);
  });

  it('rejects changing kind', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_update_column', key: 'description', patch: { kind: 'link' } }],
    }, principal)).rejects.toThrow(/cannot change column kind/i);
  });

  it('rejects unknown key', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_update_column', key: 'nope', patch: { label: 'X' } }],
    }, principal)).rejects.toThrow(/unknown column key/i);
  });
});

describe('chronology_reorder_columns', () => {
  it('reorders the columns array by the given keys', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [{ op: 'chronology_reorder_columns', keys: ['date', 'source', 'description', 'details'] }],
    }, principal);
    expect((out.data as any).columns.map((c: any) => c.key))
      .toEqual(['date', 'source', 'description', 'details']);
  });

  it('rejects when keys do not match existing column set', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_reorder_columns', keys: ['date', 'source'] }],
    }, principal)).rejects.toThrow(/must include exactly the existing column keys/i);
  });

  it('rejects empty keys array', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [{ op: 'chronology_reorder_columns', keys: [] }],
    }, principal)).rejects.toThrow(/non-empty/i);
  });
});

describe('column op sequencing in one call', () => {
  it('chains remove + set_column_widths: the second op fails if it references the removed key', async () => {
    const prod = await seedProd();
    await expect(service.update(prod.id, {
      ops: [
        { op: 'chronology_remove_column', key: 'details' },
        { op: 'chronology_set_column_widths', widths: { details: 30 } },
      ],
    }, principal)).rejects.toThrow(/unknown column key "details"/);
  });

  it('chains add + append: appended entries use the new column key', async () => {
    const prod = await seedProd();
    const out = await service.update(prod.id, {
      ops: [
        { op: 'chronology_add_column', column: { key: 'amount', label: 'Amount', width: 10, kind: 'text' } },
        { op: 'chronology_append', entries: [{ date: '2025-01-01', description: 'd', amount: '$1' }] },
      ],
    }, principal);
    expect((out.data as any).entries[0].amount).toBe('$1');
  });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement.**

Extend `Op`:
```ts
| { op: 'chronology_remove_column'; key: string }
| { op: 'chronology_update_column'; key: string; patch: { label?: string; width?: number } }
| { op: 'chronology_reorder_columns'; keys: string[] }
```

`parseOp` branches (validate `key` non-empty string; `patch` is object; reject `patch.key` and `patch.kind` with specific errors; `patch.label` non-empty string; `patch.width` in `[5,80]`; `keys` non-empty `string[]`).

`applyOp`:
```ts
case 'chronology_remove_column': {
  const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
  const idx = columns.findIndex((c) => c.key === op.key);
  if (idx < 0) throw new BadRequestException(`ops[${i}] (chronology_remove_column): unknown column key "${op.key}"`);
  if (columns.length <= 1) throw new BadRequestException(`ops[${i}] (chronology_remove_column): chronology must have at least one column`);
  columns.splice(idx, 1);
  return { ...data, columns };
}

case 'chronology_update_column': {
  const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
  const idx = columns.findIndex((c) => c.key === op.key);
  if (idx < 0) throw new BadRequestException(`ops[${i}] (chronology_update_column): unknown column key "${op.key}"`);
  columns[idx] = { ...columns[idx], ...op.patch };
  return { ...data, columns };
}

case 'chronology_reorder_columns': {
  const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
  const existing = new Set(columns.map((c) => c.key));
  const incoming = new Set(op.keys);
  if (existing.size !== incoming.size || [...existing].some((k) => !incoming.has(k))) {
    throw new BadRequestException(`ops[${i}] (chronology_reorder_columns): \`keys\` must include exactly the existing column keys`);
  }
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return { ...data, columns: op.keys.map((k) => byKey.get(k)!) };
}
```

**Step 4: Run — expect PASS.**

**Step 5: `git status` checkpoint.**

---

## Task 6: Backend — seed `columns` + normalize entries on create

**Step 1: Failing tests.**

```ts
describe('create() — chronology seeding', () => {
  it('seeds default columns when none provided', async () => {
    const out = await service.create(caseId, {
      name: 'Test', type: ProductionType.CHRONOLOGY, data: { entries: [] },
    }, principal);
    expect((out.data as any).columns.map((c: any) => c.key)).toEqual(['source', 'date', 'description', 'details']);
  });

  it('normalizes seeded entries (legacy sourceUrl → source object)', async () => {
    const out = await service.create(caseId, {
      name: 'T', type: ProductionType.CHRONOLOGY, data: {
        entries: [{ sourceUrl: 'https://x', sourceLabel: 'X', date: '2025-01-01', description: 'd' }],
      },
    }, principal);
    expect((out.data as any).entries[0].source).toEqual({ url: 'https://x', label: 'X' });
  });

  it('handles undefined data', async () => {
    const out = await service.create(caseId, {
      name: 'T', type: ProductionType.CHRONOLOGY, data: undefined as any,
    }, principal);
    expect((out.data as any).columns).toBeDefined();
    expect((out.data as any).entries).toEqual([]);
  });

  it('does not touch non-chronology types', async () => {
    const out = await service.create(caseId, {
      name: 'R', type: ProductionType.REPORT, data: { content: '<p>x</p>' },
    }, principal);
    expect((out.data as any).columns).toBeUndefined();
  });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement.**

```ts
async create(caseId: string, dto: CreateProductionDto, principal: AccessPrincipal) {
  await this.caseAccess.assertAccess(principal, caseId);
  const data = dto.type === ProductionType.CHRONOLOGY
    ? seedChronologyData(dto.data as Record<string, unknown> | undefined)
    : dto.data;
  const production = this.repo.create({ ...dto, data, caseId });
  return this.repo.save(production);
}
```

**Step 4: Run — expect PASS.**

**Step 5: `git status` checkpoint.**

---

## Task 7: Backend — TypeORM migration

**Files:**
- Create (via `./migrations.sh`): `backend/src/database/migrations/<ts>-MigrateChronologyToSchemaDriven.ts`
- Create: `backend/scripts/backfill-chronology-dev.ts` (small helper for dev)

**Step 1: Generate the migration file.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert && ./migrations.sh --dev --generate MigrateChronologyToSchemaDriven
```

The script generates an (likely empty) migration file. Open it and write the body manually — this is a JSONB content migration, not a DDL change.

**Step 2: Write `up()` and `down()`.**

```ts
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
export class MigrateChronologyToSchemaDriven<timestamp> implements MigrationInterface {
  name = 'MigrateChronologyToSchemaDriven<timestamp>';

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
          // Already canonical — no-op.
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
```

**Step 3: Create the dev-only helper script.**

```ts
// backend/scripts/backfill-chronology-dev.ts
// Run with: npx ts-node backend/scripts/backfill-chronology-dev.ts
// Applies the same transform as the migration's up() against the dev DB.
// Idempotent. Synchronize doesn't backfill data; this fills the gap on dev.
import { DataSource } from 'typeorm';
// ... import your existing data source config ...

async function main() {
  const ds = new DataSource({ /* dev config */ });
  await ds.initialize();
  // [Copy the up() body here, parameterized by ds.query]
  await ds.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

(Use the existing data source config from `backend/src/config/`. Don't hardcode connection strings.)

**Step 4: Run the dev helper to backfill local data, then verify in psql.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert && npx ts-node backend/scripts/backfill-chronology-dev.ts
psql -h localhost -p 5433 -U postgres -d daubert -c \
  "SELECT id, jsonb_pretty(data->'columns') FROM productions WHERE type='chronology' LIMIT 3;"
```
Expected: each row has a `columns` array with 4 default columns. Re-run the script — should be idempotent (no-op).

**Step 5: Leave migration file untouched in working tree. DO NOT run on prod.**

**Step 6: `git status` checkpoint.**

---

## Task 8: Backend — export templates (HTML body + CSV)

**Step 1: Failing tests** — create `backend/src/modules/export/templates/chronology.spec.ts`:

```ts
import { renderChronologyBody, renderChronologyCsv } from './chronology';

const baseData = {
  columns: [
    { key: 'source', label: 'Source', width: 25, kind: 'link' },
    { key: 'date', label: 'When', width: 15, kind: 'text' },
    { key: 'amount', label: 'Amount (USD)', width: 30, kind: 'text' },
    { key: 'notes', label: 'Notes', width: 30, kind: 'text' },
  ],
  entries: [{
    source: { url: 'https://etherscan.io/tx/0xabc', label: '0xabc…' },
    date: '2025-01-15',
    amount: '$1,200',
    notes: 'verified',
  }],
};

describe('renderChronologyBody (dynamic columns)', () => {
  it('renders a header cell per column', () => {
    const html = renderChronologyBody('t', baseData);
    expect(html).toContain('<th>Source</th>');
    expect(html).toContain('<th>When</th>');
    expect(html).toContain('<th>Amount (USD)</th>');
    expect(html).toContain('<th>Notes</th>');
  });

  it('reads custom column values from entry[column.key]', () => {
    const html = renderChronologyBody('t', baseData);
    expect(html).toContain('$1,200');
    expect(html).toContain('verified');
  });

  it('renders link column from entry.source.{url,label}', () => {
    const html = renderChronologyBody('t', baseData);
    expect(html).toMatch(/<a href="https:\/\/etherscan\.io\/tx\/0xabc">/);
    expect(html).toContain('0xabc…');
  });

  it('emits N/A when source is null', () => {
    const html = renderChronologyBody('t', {
      ...baseData,
      entries: [{ ...baseData.entries[0], source: null }],
    });
    expect(html).toContain('N/A');
  });

  it('falls back to DEFAULT_COLUMNS when data.columns is missing', () => {
    const html = renderChronologyBody('t', { entries: [] } as any);
    expect(html).toContain('<th>Source</th>');
    expect(html).toContain('<th>Date</th>');
    expect(html).toContain('<th>Description</th>');
    expect(html).toContain('<th>Details</th>');
  });
});

describe('renderChronologyCsv', () => {
  it('expands link column to URL + Label pair; emits header in column order', () => {
    const csv = renderChronologyCsv(baseData);
    const header = csv.split('\r\n')[0].replace(/^﻿/, '');
    expect(header.split(',')).toEqual([
      'Source URL', 'Source Label', 'When', 'Amount (USD)', 'Notes', 'Highlight',
    ]);
  });

  it('emits BOM prefix for Excel', () => {
    expect(renderChronologyCsv(baseData).startsWith('﻿')).toBe(true);
  });
});
```

**Step 2: Run — expect FAIL.**

**Step 3: Rewrite `renderChronologyBody` + `renderChronologyCsv` + delete the local duplicated types.**

```ts
import { BASE_STYLES, CHRONOLOGY_STYLES, CSP_META } from './styles';
import { escapeHtml, sanitizeUrl } from './util';
import { HIGHLIGHT_COLORS, isHighlightColor } from '../../productions/chronology-highlights';
import { buildFontOverrideCss, RenderOptions } from '../render-options';
import {
  ColumnDef,
  ChronologyData,
  ChronologyEntry,
  DEFAULT_COLUMNS,
} from '../../productions/chronology-schema';

function getColumns(data: ChronologyData): ColumnDef[] {
  return Array.isArray(data.columns) && data.columns.length > 0 ? data.columns : DEFAULT_COLUMNS;
}

function deriveSourceLabel(url: string): string {
  const matches = url.match(/0x[a-fA-F0-9]{8,}/g);
  if (matches && matches.length > 0) return matches[matches.length - 1].slice(0, 6) + '…';
  try {
    const u = new URL(url);
    const tail = u.pathname + u.search;
    return tail.length > 30 ? u.host + tail.slice(0, 30) + '…' : u.host + tail;
  } catch {
    return url.length > 32 ? url.slice(0, 32) + '…' : url;
  }
}

function renderCell(
  e: ChronologyEntry,
  c: ColumnDef,
  hl: { bg: string; fg: string } | null,
): string {
  if (c.kind === 'link') {
    const v = (e[c.key] as { url: string | null; label: string | null } | null) ?? null;
    const url = v?.url ?? null;
    const label = v?.label ?? (url ? deriveSourceLabel(url) : null);
    const inner = url
      ? `<a href="${escapeHtml(sanitizeUrl(url))}">${escapeHtml(label ?? url)}</a>`
      : 'N/A';
    return `<td style="font-size:9pt;font-family:monospace">${inner}</td>`;
  }
  // text — `details` keeps its smaller / muted styling for visual continuity.
  const isDetailsLike = c.key === 'details';
  const color = hl ? hl.fg : (isDetailsLike ? '#666' : 'inherit');
  const sizeStyle = isDetailsLike ? 'font-size:9pt;' : '';
  const raw = e[c.key];
  const v = typeof raw === 'string' ? raw : '';
  const display = v === '' && isDetailsLike ? '--' : v;
  return `<td style="${sizeStyle}color:${color};overflow-wrap:anywhere">${escapeHtml(display)}</td>`;
}

export function renderChronologyBody(name: string, data: ChronologyData): string {
  const columns = getColumns(data);
  const colTags = columns.map((c) => `<col style="width:${c.width}%">`).join('');
  const headerCells = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const rows = (data.entries || []).map((e) => {
    const hl = isHighlightColor(e.highlight as any) ? HIGHLIGHT_COLORS[e.highlight as any] : null;
    const rowStyle = hl ? ` style="background:${hl.bg};color:${hl.fg}"` : '';
    const cells = columns.map((c) => renderCell(e, c, hl)).join('');
    return `<tr${rowStyle}>${cells}</tr>`;
  }).join('');
  return `<table class="chronology">
  <colgroup>${colTags}</colgroup>
  <thead><tr>${headerCells}</tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

export function renderChronology(name: string, data: ChronologyData, opts?: RenderOptions): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">${CSP_META}<title>${escapeHtml(name)}</title>
<style>${BASE_STYLES}${CHRONOLOGY_STYLES}${buildFontOverrideCss(opts)}</style>
</head><body>
<h1>${escapeHtml(name)}</h1>
${renderChronologyBody(name, data)}
</body></html>`;
}

function csvCell(value: string | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function renderChronologyCsv(data: ChronologyData): string {
  const columns = getColumns(data);
  const header: string[] = [];
  for (const c of columns) {
    if (c.kind === 'link') header.push('Source URL', 'Source Label');
    else header.push(c.label);
  }
  header.push('Highlight');

  const lines = [header.join(',')];
  for (const e of data.entries || []) {
    const cells: string[] = [];
    for (const c of columns) {
      if (c.kind === 'link') {
        const v = (e[c.key] as { url: string | null; label: string | null } | null) ?? null;
        const url = v?.url ?? null;
        const label = v?.label ?? (url ? deriveSourceLabel(url) : null);
        cells.push(csvCell(url), csvCell(label));
      } else {
        const raw = e[c.key];
        cells.push(csvCell(typeof raw === 'string' ? raw : ''));
      }
    }
    cells.push(csvCell(isHighlightColor(e.highlight as any) ? (e.highlight as string) : ''));
    lines.push(cells.join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
```

**Step 4: Run — expect PASS.**

**Step 5: `git status` checkpoint.**

---

## Task 9: Backend — update agent tool definitions

**Files:**
- Modify: `backend/src/modules/ai/tools/tool-definitions.ts`

**Step 1: Update `CREATE_PRODUCTION_TOOL` description (the `data` field).**

Replace the chronology line in the description with:

> For chronology: `{ entries: [{ source: { url, label? } | null, date, description, details?, highlight?, [customColumnKey]?: string }], columns?: [{ key, label, width: 5-80, kind: "text" | "link" }] }`. The chronology title comes from the top-level `name` field. `columns` is optional; defaults to source/date/description/details. **Legacy entry shape** (`{ sourceUrl, sourceLabel, ... }` or `source` as a string) is silently normalized inbound. `highlight` is an optional row background color — `"yellow" | "gray" | "red" | "green" | "blue"`.

**Step 2: Update `UPDATE_PRODUCTION_TOOL` op list.** Replace the existing five-op block with:

```
- `{ op: "chronology_append", entries: [...] }` — append rows. Each entry: { source: { url, label? } | null, date, description, details?, [customKey]?: string }. Legacy { sourceUrl, sourceLabel } is normalized.
- `{ op: "chronology_replace", index, entry }` — replace at zero-based index. Entry normalized inbound.
- `{ op: "chronology_delete", indexes: [...] }` — delete at zero-based indexes.
- `{ op: "chronology_set_row_highlight", indexes, color }` — color ∈ "yellow"|"gray"|"red"|"green"|"blue"|null.
- `{ op: "chronology_set_column_widths", widths: { <columnKey>: 5–80, ... } }` — set widths on any existing column key. Replaces the prior allowlist (source/date/description/details) — now accepts any key in data.columns.
- `{ op: "chronology_add_column", column: { key, label, width: 5–80, kind: "text" }, index? }` — add a new TEXT column. Key is immutable, must not collide with existing or reserved keys (highlight, sourceTraceId, sourceEdgeId, source). Width is percent.
- `{ op: "chronology_remove_column", key }` — remove a column. Entry data under that key is preserved (orphan-tolerant) — re-adding the same key restores rendering. Cannot remove the last remaining column.
- `{ op: "chronology_update_column", key, patch: { label?, width? } }` — rename or resize a column. Key and kind are immutable.
- `{ op: "chronology_reorder_columns", keys: [...] }` — reorder columns. `keys` must be a permutation of existing column keys.
- `{ op: "chart_set_height", height: <px> }` — unchanged.
```

**Step 3: TypeScript check.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/backend && npx tsc --noEmit
```

**Step 4: `git status` checkpoint.**

---

## Task 10: Backend — update agent skill doc + investigator prompt

**Files:**
- Modify: `backend/src/skills/productions.md` (chronology section)
- Modify: `backend/src/prompts/investigator.ts` (lines ~46–48)

**Step 1: Rewrite the chronology section of `productions.md`.**

Document:
- New canonical entry shape: `{ source: { url, label? } | null, date, description, details?, [customKey]?: string, highlight? }`.
- Legacy entry shape (`{ sourceUrl, sourceLabel, ... }`) still accepted on input; normalized.
- `columns` array: agent can `add_column` / `remove_column` / `update_column` / `reorder_columns` to shape the table to the case.
- Example: "If this chronology centers on cash transfers, add an `amount` column: `{ op: 'chronology_add_column', column: { key: 'amount', label: 'Amount (USD)', width: 12, kind: 'text' } }` and then include `amount: '$1,200'` in each appended entry."

**Step 2: Update `investigator.ts:46-48`.**

The current guidance hardcodes `{ date, description, sourceUrl, sourceLabel }`. Update to point at the new entry shape and remind the agent it can add custom columns when the chronology has a dominant attribute (amounts, counterparties, exhibit numbers).

**Step 3: `git status` checkpoint.**

---

## Task 11: Frontend — `chronologySchema.ts` mirror

**Files:**
- Create: `frontend/src/lib/chronologySchema.ts`

**Step 1: Implement.**

```ts
// Mirror of backend/src/modules/productions/chronology-schema.ts. Keep in sync.

export type ColumnKind = 'text' | 'link';

export interface ColumnDef {
  key: string;
  label: string;
  width: number;
  kind: ColumnKind;
}

export interface ChronologyLinkValue {
  url: string | null;
  label: string | null;
}

export interface ChronologyEntry {
  highlight?: string | null;
  sourceTraceId?: string;
  sourceEdgeId?: string;
  source?: ChronologyLinkValue | null;
  [columnKey: string]: unknown;
}

export interface ChronologyData {
  entries: ChronologyEntry[];
  columns?: ColumnDef[];
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: 'source',      label: 'Source',      width: 18, kind: 'link' },
  { key: 'date',        label: 'Date',        width: 14, kind: 'text' },
  { key: 'description', label: 'Description', width: 40, kind: 'text' },
  { key: 'details',     label: 'Details',     width: 28, kind: 'text' },
];

export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'highlight', 'sourceTraceId', 'sourceEdgeId', 'source',
]);

export function isReservedColumnKey(k: string): boolean { return RESERVED_KEYS.has(k); }

export function slugifyColumnLabel(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) throw new Error('Column label must contain at least one alphanumeric character');
  return slug;
}

export function getColumns(data: ChronologyData | undefined | null): ColumnDef[] {
  return Array.isArray(data?.columns) && data!.columns!.length > 0 ? data!.columns! : DEFAULT_COLUMNS;
}
```

**Step 2: TypeScript check.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/frontend && npx tsc --noEmit
```

**Step 3: `git status` checkpoint.**

---

## Task 12: Frontend — rewrite `ChronologyTable`

**Files:**
- Modify: `frontend/src/components/Productions/ChronologyTable.tsx`

**Step 1: Replace local types + defaults with imports from `@/lib/chronologySchema`.**

Delete the local `ChronologyEntry`, `ColumnWidths`, `ChronologyData`, `DEFAULT_WIDTHS`, `COL_KEYS`. Import `ColumnDef`, `ChronologyData`, `ChronologyEntry`, `DEFAULT_COLUMNS`, `getColumns`, `slugifyColumnLabel` from `@/lib/chronologySchema`.

**Step 2: Update props.**

```ts
interface ChronologyTableProps {
  data: ChronologyData;
  onColumnResize?: (widths: Record<string, number>) => void;
  onColumnAdd?: (column: ColumnDef) => void;
  onColumnRemove?: (key: string) => void;
  onColumnRename?: (key: string, label: string) => void;
  onEntryEdit?: (index: number, entry: ChronologyEntry) => void;
  onRowHighlight?: (indexes: number[], color: HighlightColor | null) => void;
  onRowsDelete?: (indexes: number[]) => void;
}
```

**Step 3: Render dynamic colgroup + header.**

```tsx
const columns = getColumns(data);

// `widths` state is now Record<string, number> (drag-state map).

<table ref={tableRef} className="w-full text-sm table-fixed">
  <colgroup>
    {columns.map((c) => (
      <col key={c.key} style={{ width: `${widths[c.key] ?? c.width}%` }} />
    ))}
  </colgroup>
  <thead>
    <tr className="bg-surface-panel/50 text-left text-ink-muted select-none">
      {columns.map((col, i) => (
        <ResizableTh
          key={col.key}
          column={col}
          onResizeStart={i < columns.length - 1 && onColumnResize ? (e) => startDrag(i, e) : undefined}
          active={activeHandle === i}
          onRename={onColumnRename && col.kind === 'text' ? (label) => onColumnRename(col.key, label) : undefined}
          onRemove={onColumnRemove && columns.length > 1 && col.kind === 'text' ? () => onColumnRemove(col.key) : undefined}
        />
      ))}
    </tr>
  </thead>
  <tbody>{/* dispatched cells, see step 4 */}</tbody>
</table>

{/* "+ Add column" lives OUTSIDE the table to keep <colgroup> math clean */}
{onColumnAdd && (
  <AddColumnButton existingKeys={columns.map((c) => c.key)} onAdd={onColumnAdd} />
)}
```

(`col.kind === 'text'` gate on rename/remove keeps the source column non-renamable/non-removable in Phase 1 — see decision points.)

**Step 4: Cell dispatcher.**

```tsx
{data.entries.map((entry, i) => {
  const hl = isHighlightColor(entry.highlight as any) ? HIGHLIGHT_COLORS[entry.highlight as HighlightColor] : null;
  const rowStyle = hl ? { background: hl.bg, color: hl.fg } : undefined;
  return (
    <tr key={i} className={`...`} style={rowStyle}>
      {columns.map((col, ci) => (
        <Cell
          key={col.key}
          column={col}
          entry={entry}
          rowIndex={i}
          isFirst={ci === 0}
          hl={hl}
          editable={!!onEntryEdit && col.kind === 'text'}
          onEdit={onEntryEdit ? (value) => onEntryEdit(i, { ...entry, [col.key]: value }) : undefined}
          onRowHighlight={onRowHighlight}
          selectMode={selectMode}
          isSelected={selected.has(i)}
          toggleRow={() => toggleRow(i)}
        />
      ))}
    </tr>
  );
})}
```

`Cell` dispatch:
- `col.kind === 'link'` (only source): render existing anchor/label/swatch/checkbox logic. Read `entry.source?.url` and `entry.source?.label`.
- `col.kind === 'text'`: render `EditableCell` if `editable`, else plain text. Read `entry[col.key]` as string. Special `details` styling (`text-xs`, `--` placeholder) gated on `col.key === 'details'`.

**Step 5: Generalize drag-resize.**

```ts
const startDrag = useCallback((handleIdx: number, e: React.PointerEvent) => {
  e.preventDefault();
  const tableEl = tableRef.current;
  if (!tableEl) return;
  setActiveHandle(handleIdx);
  const tableWidth = tableEl.offsetWidth;
  const startX = e.clientX;
  const aKey = columns[handleIdx].key;
  const bKey = columns[handleIdx + 1].key;
  const startA = widths[aKey] ?? columns[handleIdx].width;
  const startB = widths[bKey] ?? columns[handleIdx + 1].width;
  // ... clamp logic unchanged but operates on aKey/bKey ...
  // On drag end: onColumnResize?.({ [aKey]: newA, [bKey]: newB })
}, [columns, widths, onColumnResize]);
```

`widths` state becomes `Record<string, number>` (drag-only overlay). The "drop drag override once saved widths match" effect compares all `columns[*].width` keyed by `col.key`.

**Step 6: `AddColumnButton`.**

```tsx
function AddColumnButton({
  existingKeys, onAdd,
}: { existingKeys: string[]; onAdd: (col: ColumnDef) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    let key: string;
    try { key = slugifyColumnLabel(trimmed); }
    catch (e: any) { setError(e.message); return; }
    let unique = key;
    let n = 1;
    while (existingKeys.includes(unique)) { unique = `${key}_${++n}`; }
    onAdd({ key: unique, label: trimmed, width: 10, kind: 'text' });
    setLabel(''); setOpen(false); setError(null);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-ink-muted hover:text-brand inline-flex items-center gap-1.5"
      >
        + Add column
      </button>
    );
  }
  return (
    <div className="mt-2 inline-flex items-center gap-2">
      <input
        autoFocus
        value={label}
        onChange={(e) => { setLabel(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') { setOpen(false); setLabel(''); setError(null); }
        }}
        onBlur={() => { if (!label.trim()) setOpen(false); }}
        placeholder="Column name"
        className="text-xs bg-surface px-2 py-1 rounded border border-brand focus:outline-none w-40"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
```

**Step 7: `ResizableTh` with rename + remove affordances.**

Extend the existing `ResizableTh` to accept `column: ColumnDef`, `onRename?`, `onRemove?`. When `onRename` present, clicking the label puts it in an inline edit state (Enter to commit, Esc to cancel). When `onRemove` present, show a small "×" on hover. Resize grip stays as today.

**Step 8: TypeScript check + dev smoke.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert/frontend && npx tsc --noEmit
```

Then run the stack and test in browser:
```bash
cd /Users/Sam/Work/Incite/dev/daubert && npm run db && (npm run be & npm run fe)
```

Smoke checklist (per CLAUDE.md "UI changes test the feature in a browser"):
1. Existing chronology renders identically — 4 columns, same widths after migration backfill.
2. Drag a resize handle — widths persist after refresh.
3. Click "+ Add column" → "Amount" → Enter → new column appears empty.
4. Click into an "Amount" cell → type `$1,200` → click out → persists after refresh.
5. Click "Amount" header → rename to "Value (USD)" → Enter → persists.
6. Hover "Value (USD)" header → click "×" → confirm column gone.
7. Source column header has no rename/remove affordances.
8. Export CSV → header columns match table columns.
9. Export PDF → rendered table matches.
10. Open a freshly created chronology → source column renders the anchor link correctly (entry.source.url path).

**Step 9: `git status` checkpoint.**

---

## Task 13: Frontend — wire `ProductionViewer` to new ops

**Files:**
- Modify: `frontend/src/components/Productions/ProductionViewer.tsx`

**Step 1: Change `handleColumnResize` type signature.**

```ts
const handleColumnResize = useCallback(
  async (widths: Record<string, number>) => {
    try {
      const updated = await apiClient.updateProduction(production.id, {
        ops: [{ op: 'chronology_set_column_widths', widths }],
      });
      onUpdate?.(updated);
    } catch (err) {
      console.error('Failed to save column widths:', err);
    }
  },
  [production.id, onUpdate],
);
```

**Step 2: Add three new handlers** (`handleColumnAdd`, `handleColumnRemove`, `handleColumnRename`) — same pattern, each emits a single op. On error, also surface to a small inline `lastError` state so the user sees rename/remove failures (matching the resilience goal from the review).

**Step 3: Pass into `<ChronologyTable />`.**

```tsx
<ChronologyTable
  data={data}
  onColumnResize={handleColumnResize}
  onColumnAdd={handleColumnAdd}
  onColumnRemove={handleColumnRemove}
  onColumnRename={handleColumnRename}
  onEntryEdit={handleEntryEdit}
  onRowHighlight={handleRowHighlight}
  onRowsDelete={handleRowsDelete}
/>
```

**Step 4: TypeScript check.**

**Step 5: `git status` checkpoint.**

---

## Task 14: Frontend — confirm `NewPrimaryModal` works without change

**Files:**
- Read: `frontend/src/components/Workspace/NewPrimaryModal.tsx:33-36`
- Modify only if grep confirms `data.title` is unused.

**Step 1: Grep.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert && grep -rn "data\.title\|data\?\.title" frontend/src backend/src
```

If no hits → drop `title: trimmed` from the modal call. Backend seeding (`seedChronologyData`) handles the rest. If hits exist → leave alone.

**Step 2: `git status` checkpoint.**

---

## Task 15: End-to-end smoke

**Step 1: Reset dev DB to confirm seed-on-create works on a clean slate.**

```bash
cd /Users/Sam/Work/Incite/dev/daubert
docker compose down -v && npm run db
npm run be & npm run fe
```

(Or use whatever the project's preferred reset command is — confirm via `package.json` scripts.)

**Step 2: Run the backfill helper script against the (now empty) dev DB — should no-op cleanly.**

```bash
npx ts-node backend/scripts/backfill-chronology-dev.ts
```

**Step 3: Browser happy-path.**

1. Create new chronology in UI → `data.columns` populated.
2. From the agent panel: `update_production` with `chronology_add_column` for "Amount" → column appears after refresh.
3. Agent runs `chronology_append` with `[{ source: {url: 'https://x', label: 'X'}, date: '2025-01-01', description: 'd', amount: '$100' }]` → row populates including custom column.
4. Drag resize → persist.
5. Header rename → persist.
6. Header "×" → column hidden, data preserved in JSONB.
7. CSV export → columns reflect current schema.
8. PDF export → table renders dynamically.

**Step 4: Agent legacy-shape regression check.**

Manually invoke the agent with the legacy entry shape:
```
update_production with chronology_append: [{ sourceUrl: 'https://y', sourceLabel: 'Y', date: '2025-02-01', description: 'legacy entry' }]
```

Confirm: entry persists with canonical `source: { url: 'https://y', label: 'Y' }` shape; renders correctly.

**Step 5: Final `git status` + `git diff --stat`. Hand off to user.**

---

## Decision points still open

These are flagged so the user can override during execution; defaults are reasonable.

1. **Should the `source` column be renamable / removable in Phase 1?**
   - Plan default: NO — source is locked. Source has `kind: 'link'` and special-cased rendering; allowing removal in Phase 1 means a chronology can end up with zero link columns and no way to add one back (since `add_column` rejects `kind: 'link'`). Risk asymmetry not worth Phase-1 spend.
   - Recommended: keep locked. Revisit in Phase 2 when we generalize link columns.

2. **What happens to the table's total-width sum when a column is added?**
   - Plan default: new columns added at `width: 10`. Sum can drift past 100%; `table-layout: fixed` clips gracefully but the visual is "everything compresses slightly."
   - Recommended: leave as-is for Phase 1. Phase 2 normalizes (subtract from largest neighbor or rebalance proportionally).

3. **CSV column order changes after this PR ships.**
   - Old: `Date, Source URL, Source Label, Description, Details, Highlight`.
   - New: `Source URL, Source Label, Date, Description, Details, Highlight` (visual order).
   - If anyone downstream pipes CSV into a script keyed by column index, that script breaks. The "What changes (UX)" section calls this out; consider whether to also ship a `?legacy_csv=1` flag as an escape hatch.
   - Recommended: ship the new order; no flag. Anyone consuming CSV from us has a person in the loop.
