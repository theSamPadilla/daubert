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
      const cols = [{ key: 'a', label: 'A', width: 80, kind: 'text' as const }];
      const out = seedChronologyData({ entries: [], columns: cols });
      expect(out.columns).toEqual(cols);
    });
    it('rejects caller-provided columns with invalid width', () => {
      expect(() => seedChronologyData({
        entries: [],
        columns: [{ key: 'a', label: 'A', width: 999, kind: 'text' }],
      } as any)).toThrow(/between 5 and 80/);
    });
    it('rejects caller-provided columns with invalid kind', () => {
      expect(() => seedChronologyData({
        entries: [],
        columns: [{ key: 'a', label: 'A', width: 50, kind: 'banana' }],
      } as any)).toThrow(/kind must be "text" or "link"/);
    });
    it('rejects link-kind on non-source columns', () => {
      expect(() => seedChronologyData({
        entries: [],
        columns: [{ key: 'extra', label: 'Extra', width: 50, kind: 'link' }],
      } as any)).toThrow(/reserved for the built-in source column/);
    });
    it('rejects duplicate caller-provided keys', () => {
      expect(() => seedChronologyData({
        entries: [],
        columns: [
          { key: 'a', label: 'A', width: 40, kind: 'text' },
          { key: 'a', label: 'Again', width: 40, kind: 'text' },
        ],
      } as any)).toThrow(/duplicate key/);
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
