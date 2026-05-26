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
