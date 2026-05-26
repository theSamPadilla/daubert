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
//   source: { url, label }    →  unchanged (label coerced to null if missing)
//   missing                   →  source: null
//
// Precedence when both legacy and canonical are present: legacy wins. This
// matches the migration's behavior — agents/clients that ship both `sourceUrl`
// and `source: {...}` get the flat-field interpretation.
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

// Validate one caller-provided ColumnDef. Used by `seedChronologyData` on the
// creation path; ops paths (`chronology_add_column`) do their own validation
// with the same rules. Throws on any violation.
export function validateColumnDef(c: unknown, context: string): ColumnDef {
  if (c === null || typeof c !== 'object') {
    throw new Error(`${context}: column must be an object`);
  }
  const obj = c as Record<string, unknown>;
  if (typeof obj.key !== 'string' || !obj.key.trim()) {
    throw new Error(`${context}: column.key must be a non-empty string`);
  }
  if (typeof obj.label !== 'string' || !obj.label.trim()) {
    throw new Error(`${context}: column.label must be a non-empty string`);
  }
  if (typeof obj.width !== 'number' || !Number.isFinite(obj.width) || obj.width < 5 || obj.width > 80) {
    throw new Error(`${context}: column.width must be a number between 5 and 80`);
  }
  if (obj.kind !== 'text' && obj.kind !== 'link') {
    throw new Error(`${context}: column.kind must be "text" or "link"`);
  }
  return { key: obj.key, label: obj.label, width: obj.width, kind: obj.kind };
}

// Normalize whatever shape the caller (agent or UI) sent into canonical data.
// Caller-provided columns are validated (throws on bad shape). Duplicate keys
// rejected. The built-in `source` link column is the only allowed link kind in
// caller input — any other link-kind column is rejected (matches add_column).
export function seedChronologyData(
  input: Record<string, unknown> | undefined,
): ChronologyData {
  const src = (input ?? {}) as Partial<ChronologyData>;
  const rawEntries = Array.isArray(src.entries) ? src.entries : [];
  const entries = rawEntries.map((e) => normalizeEntry(e as Record<string, unknown>));

  let columns: ColumnDef[];
  if (Array.isArray(src.columns) && src.columns.length > 0) {
    const seen = new Set<string>();
    columns = src.columns.map((c, i) => {
      const col = validateColumnDef(c, `seedChronologyData: columns[${i}]`);
      if (col.kind === 'link' && col.key !== 'source') {
        throw new Error(`seedChronologyData: columns[${i}].kind="link" is reserved for the built-in source column (key="source"); custom columns must be "text"`);
      }
      if (seen.has(col.key)) {
        throw new Error(`seedChronologyData: columns[${i}] duplicate key "${col.key}"`);
      }
      seen.add(col.key);
      return col;
    });
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
