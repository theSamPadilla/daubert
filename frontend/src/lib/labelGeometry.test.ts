import { resolveLabelRenderedPosition, modelDeltaFromRenderedDelta, projectPointOntoEdge } from './labelGeometry';

describe('labelGeometry', () => {
  describe('resolveLabelRenderedPosition', () => {
    it('resolves a free anchor by applying pan + zoom', () => {
      const out = resolveLabelRenderedPosition(
        { type: 'free', x: 100, y: 50 },
        { pan: { x: 10, y: 20 }, zoom: 2 } as any,
      );
      expect(out).toEqual({ x: 210, y: 120 }); // x_rendered = x_model * zoom + panX
    });

    it('resolves a node anchor relative to the node\'s rendered position', () => {
      const fakeNode = { renderedPosition: () => ({ x: 300, y: 200 }) } as any;
      const out = resolveLabelRenderedPosition(
        { type: 'node', anchorId: 'n1', dx: 20, dy: -10 },
        { zoom: 2, getNode: (_id: string) => fakeNode } as any,
      );
      // dx/dy are model-space; convert to rendered by * zoom
      expect(out).toEqual({ x: 340, y: 180 });
    });

    it('resolves an edge anchor using t and perpOffset', () => {
      const fakeEdge = {
        source: () => ({ renderedPosition: () => ({ x: 0, y: 0 }) }),
        target: () => ({ renderedPosition: () => ({ x: 100, y: 0 }) }),
      } as any;
      const out = resolveLabelRenderedPosition(
        { type: 'edge', anchorId: 'e1', t: 0.5, perpOffset: 10 },
        { zoom: 1, getEdge: (_id: string) => fakeEdge } as any,
      );
      // midpoint (50, 0), perpendicular is (0, ±1) for a horizontal line; perpOffset=10 along (0, -1) per convention
      expect(out).toEqual({ x: 50, y: -10 });
    });

    it('resolves a txEdge anchor by looking up the edge via txHash', () => {
      const fakeEdge = {
        source: () => ({ renderedPosition: () => ({ x: 0, y: 0 }) }),
        target: () => ({ renderedPosition: () => ({ x: 100, y: 0 }) }),
      } as any;
      const out = resolveLabelRenderedPosition(
        { type: 'txEdge', txHash: '0xabc', t: 0.5, perpOffset: 0 },
        { zoom: 1, getEdgeByTxHash: (h: string) => h === '0xabc' ? fakeEdge : null } as any,
      );
      expect(out).toEqual({ x: 50, y: 0 });
    });

    it('returns null for txEdge anchor when no edge has matching txHash (e.g. trace hidden)', () => {
      const out = resolveLabelRenderedPosition(
        { type: 'txEdge', txHash: '0xnotfound', t: 0.5, perpOffset: 0 },
        { zoom: 1, getEdgeByTxHash: () => null } as any,
      );
      expect(out).toBeNull();
    });

    it('returns null when the tethered element is missing', () => {
      const out = resolveLabelRenderedPosition(
        { type: 'node', anchorId: 'gone', dx: 0, dy: 0 },
        { zoom: 1, getNode: () => null } as any,
      );
      expect(out).toBeNull();
    });
  });

  describe('modelDeltaFromRenderedDelta', () => {
    it('divides by zoom to convert rendered pixels back to model units', () => {
      expect(modelDeltaFromRenderedDelta({ dx: 40, dy: 20 }, 2)).toEqual({ dx: 20, dy: 10 });
    });
  });

  describe('projectPointOntoEdge', () => {
    it('returns t=0.5 for a point at the midpoint of a horizontal edge', () => {
      const out = projectPointOntoEdge({ x: 50, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(out.t).toBeCloseTo(0.5);
      expect(out.perpOffset).toBeCloseTo(-5);
    });
    it('clamps t to [0, 1]', () => {
      const out = projectPointOntoEdge({ x: -50, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(out.t).toBe(0);
    });
  });

  describe('projectPointOntoEdge round-trip with resolveLabelRenderedPosition', () => {
    it('resolve then project returns the original (t, perpOffset)', () => {
      const fakeEdge = {
        source: () => ({ renderedPosition: () => ({ x: 0, y: 0 }) }),
        target: () => ({ renderedPosition: () => ({ x: 100, y: 0 }) }),
      } as any;
      const ctx = { zoom: 1, getEdge: () => fakeEdge } as any;
      const original = { type: 'edge' as const, anchorId: 'e1', t: 0.3, perpOffset: 17 };
      const rendered = resolveLabelRenderedPosition(original, ctx)!;
      const back = projectPointOntoEdge(rendered, { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(back.t).toBeCloseTo(original.t);
      expect(back.perpOffset).toBeCloseTo(original.perpOffset);
    });

    it('round-trip for a negative perpOffset', () => {
      const fakeEdge = {
        source: () => ({ renderedPosition: () => ({ x: 0, y: 0 }) }),
        target: () => ({ renderedPosition: () => ({ x: 100, y: 0 }) }),
      } as any;
      const ctx = { zoom: 1, getEdge: () => fakeEdge } as any;
      const original = { type: 'edge' as const, anchorId: 'e1', t: 0.7, perpOffset: -22 };
      const rendered = resolveLabelRenderedPosition(original, ctx)!;
      const back = projectPointOntoEdge(rendered, { x: 0, y: 0 }, { x: 100, y: 0 });
      expect(back.t).toBeCloseTo(original.t);
      expect(back.perpOffset).toBeCloseTo(original.perpOffset);
    });
  });
});
