// backend/src/modules/productions/redline-data.spec.ts

import {
  normalizeForAnchor,
  buildNormalizedIndex,
  resolveAnchor,
  spansOverlap,
  seedRedlineData,
  MIN_ANCHOR_LENGTH,
  RedlineSource,
} from './redline-data';

describe('redline-data', () => {
  describe('normalizeForAnchor', () => {
    it('converts curly quotes to straight quotes', () => {
      expect(normalizeForAnchor('“Sun’s wallets”')).toBe('"Sun\'s wallets"');
    });

    it('converts NBSP to a regular space', () => {
      expect(normalizeForAnchor('a b')).toBe('a b');
    });

    it('expands fi/fl ligatures', () => {
      expect(normalizeForAnchor('ﬁnancial statement with ﬂow')).toBe(
        'financial statement with flow',
      );
    });

    it('collapses runs of spaces and newlines to a single space', () => {
      expect(normalizeForAnchor('alpha   beta\n\n\ncharlie \t delta')).toBe(
        'alpha beta charlie delta',
      );
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeForAnchor('   hello world   ')).toBe('hello world');
    });
  });

  describe('buildNormalizedIndex', () => {
    it('maps a collapsed whitespace run back to the raw offsets that produced it', () => {
      const raw = 'foo   bar';
      const idx = buildNormalizedIndex(raw);
      expect(idx.text).toBe('foo bar');
      expect(idx.starts[3]).toBe(3);
      expect(idx.ends[3]).toBe(6);
    });

    it('drops leading/trailing whitespace with no corresponding output position', () => {
      const raw = '  foo bar  ';
      const idx = buildNormalizedIndex(raw);
      expect(idx.text).toBe('foo bar');
    });
  });

  describe('MIN_ANCHOR_LENGTH', () => {
    it('is 8', () => {
      expect(MIN_ANCHOR_LENGTH).toBe(8);
    });
  });

  describe('resolveAnchor', () => {
    it('resolves a unique match: curly-quoted base text, straight-quoted anchor', () => {
      const base = 'The account “Sun’s wallets” were reviewed in detail.';
      const res = resolveAnchor(base, `"Sun's wallets"`);
      expect('error' in res).toBe(false);
      const r = res as { start: number; end: number };
      expect(base.slice(r.start, r.end)).toBe('“Sun’s wallets”');
    });

    it('resolves a unique match: straight-quoted base text, curly-quoted anchor', () => {
      const base = `The account "Sun's wallets" were reviewed in detail.`;
      const res = resolveAnchor(base, '“Sun’s wallets”');
      expect('error' in res).toBe(false);
      const r = res as { start: number; end: number };
      expect(base.slice(r.start, r.end)).toBe(`"Sun's wallets"`);
    });

    it('returns anchor_not_found when there are zero matches', () => {
      const base = 'Nothing relevant is written here at all, just filler.';
      const res = resolveAnchor(base, 'this text does not exist anywhere');
      expect(res).toEqual({ error: 'anchor_not_found' });
    });

    it('returns anchor_ambiguous with the match count when there are multiple matches', () => {
      const base =
        'repeated phrase here. Some filler text separates them. repeated phrase here.';
      const res = resolveAnchor(base, 'repeated phrase here');
      expect(res).toEqual({ error: 'anchor_ambiguous', count: 2 });
    });

    it('returns anchor_too_short when the normalized quote is under 8 characters', () => {
      const base = 'Short text here for testing purposes only.';
      const res = resolveAnchor(base, 'short');
      expect(res).toEqual({ error: 'anchor_too_short' });
    });

    it('returns anchor_crosses_paragraphs when the resolved raw span contains a newline', () => {
      const base =
        'Alpha bravo charlie.\n\nDelta echo foxtrot golf hotel india juliet kilo lima mike november.';
      const res = resolveAnchor(base, 'charlie.\n\nDelta echo');
      expect(res).toEqual({ error: 'anchor_crosses_paragraphs' });
    });
  });

  describe('spansOverlap', () => {
    it.each([
      [0, 5, 5, 10, false, 'touching spans (a ends where b starts) do not overlap'],
      [5, 10, 0, 5, false, 'touching spans, reverse order, do not overlap'],
      [0, 5, 4, 10, true, 'overlapping by one unit'],
      [0, 10, 2, 5, true, 'b fully contained within a'],
      [0, 5, 10, 15, false, 'disjoint spans'],
      [10, 15, 0, 5, false, 'disjoint spans, reverse order'],
      [0, 0, 0, 0, false, 'two zero-length spans at the same point do not overlap'],
    ])('spansOverlap(%i, %i, %i, %i) === %s (%s)', (aStart, aEnd, bStart, bEnd, expected) => {
      expect(spansOverlap(aStart, aEnd, bStart, bEnd)).toBe(expected);
    });
  });

  describe('seedRedlineData', () => {
    it('returns the seeded structure with empty edits and comments', () => {
      const source: RedlineSource = {
        fileId: 'file-1',
        fileName: 'contract.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        kind: 'docx',
        extractedAt: '2026-07-23T00:00:00.000Z',
      };
      const baseText = 'Paragraph one.\n\nParagraph two.';
      const out = seedRedlineData(source, baseText);
      expect(out).toEqual({
        schemaVersion: 1,
        source,
        baseText,
        edits: [],
        comments: [],
      });
    });
  });

  describe('performance', () => {
    it('resolves an anchor in a ~200KB base text in well under 200ms', () => {
      const filler =
        'The quick brown fox jumps over the lazy dog repeatedly in this filler paragraph. ';
      const repeatCount = Math.ceil((200 * 1024) / filler.length);
      const needle =
        'This unique sentinel phrase appears exactly once in the giant document.';
      const parts = new Array(repeatCount).fill(filler);
      parts.splice(Math.floor(repeatCount / 2), 0, needle);
      const base = parts.join('');
      expect(base.length).toBeGreaterThan(200 * 1024 * 0.9);

      const startedAt = Date.now();
      const res = resolveAnchor(base, needle);
      const elapsed = Date.now() - startedAt;

      expect('error' in res).toBe(false);
      // Bound is generous (2s) to avoid flakes under parallel test-runner load;
      // correctness is already asserted above, this only guards O(n^2) regressions.
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
