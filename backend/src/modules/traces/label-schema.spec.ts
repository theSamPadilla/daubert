// backend/src/modules/traces/label-schema.spec.ts
import { validateLabels, normalizeLabels, MAX_LABEL_TEXT_LENGTH } from './label-schema';

describe('label-schema', () => {
  describe('validateLabels', () => {
    it('accepts a valid free-floating label', () => {
      expect(() =>
        validateLabels([{ id: 'l1', text: 'hello', anchor: { type: 'free', x: 100, y: 50 } }]),
      ).not.toThrow();
    });

    it('accepts a valid node-tethered label', () => {
      expect(() =>
        validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'node', anchorId: 'n1', dx: 10, dy: -20 } }]),
      ).not.toThrow();
    });

    it('accepts a valid edge-tethered label', () => {
      expect(() =>
        validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'edge', anchorId: 'e1', t: 0.5, perpOffset: 8 } }]),
      ).not.toThrow();
    });

    it('accepts a valid txEdge-tethered label', () => {
      expect(() =>
        validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'txEdge', txHash: '0xabc123', t: 0.5, perpOffset: 8 } }]),
      ).not.toThrow();
    });

    it('rejects missing id', () => {
      expect(() => validateLabels([{ text: 'x', anchor: { type: 'free', x: 0, y: 0 } } as any])).toThrow(/id/);
    });

    it('rejects non-string text', () => {
      expect(() => validateLabels([{ id: 'l1', text: 123 as any, anchor: { type: 'free', x: 0, y: 0 } }])).toThrow(/text/);
    });

    it('rejects text longer than MAX_LABEL_TEXT_LENGTH', () => {
      const long = 'x'.repeat(MAX_LABEL_TEXT_LENGTH + 1);
      expect(() => validateLabels([{ id: 'l1', text: long, anchor: { type: 'free', x: 0, y: 0 } }])).toThrow(/length/);
    });

    it('rejects mismatched anchor shape (node anchor missing anchorId)', () => {
      expect(() => validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'node', dx: 0, dy: 0 } as any }])).toThrow(/anchorId/);
    });

    it('rejects edge anchor with t outside [0, 1]', () => {
      expect(() => validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'edge', anchorId: 'e1', t: 1.5, perpOffset: 0 } }])).toThrow(/t.*0.*1/i);
    });

    it('rejects duplicate ids in the same array', () => {
      expect(() => validateLabels([
        { id: 'l1', text: 'a', anchor: { type: 'free', x: 0, y: 0 } },
        { id: 'l1', text: 'b', anchor: { type: 'free', x: 1, y: 1 } },
      ])).toThrow(/duplicate/i);
    });

    it('accepts an empty array', () => {
      expect(() => validateLabels([])).not.toThrow();
    });

    it('rejects txEdge anchor missing txHash', () => {
      expect(() => validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'txEdge', t: 0.5, perpOffset: 0 } as any }])).toThrow(/txHash/);
    });

    it('rejects txEdge anchor with t outside [0, 1]', () => {
      expect(() => validateLabels([{ id: 'l1', text: 'x', anchor: { type: 'txEdge', txHash: '0xabc', t: -0.1, perpOffset: 0 } }])).toThrow(/t.*0.*1/i);
    });
  });

  describe('normalizeLabels', () => {
    it('returns empty array when input is undefined', () => {
      expect(normalizeLabels(undefined)).toEqual([]);
    });
    it('passes valid input through unchanged', () => {
      const labels = [{ id: 'l1', text: 'x', anchor: { type: 'free' as const, x: 0, y: 0 } }];
      expect(normalizeLabels(labels)).toEqual(labels);
    });
    it('strips unknown fields on each label', () => {
      const input = [{ id: 'l1', text: 'x', anchor: { type: 'free', x: 0, y: 0 }, evil: 'payload' } as any];
      expect(normalizeLabels(input)[0]).not.toHaveProperty('evil');
    });
  });
});
