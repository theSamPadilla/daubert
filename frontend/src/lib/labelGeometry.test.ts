import { resolveLabelRenderedPosition, modelDeltaFromRenderedDelta, projectPointOntoEdge, exportContextFromCy, EXPORT_PADDING } from './labelGeometry';

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

describe('EXPORT_PADDING', () => {
  it('is 50px (matches cy.fit padding for visual consistency)', () => {
    expect(EXPORT_PADDING).toBe(50);
  });
});

describe('exportContextFromCy', () => {
  function makeFakeCy(overrides: Partial<any> = {}) {
    return {
      zoom: jest.fn(() => 0.37),                  // export must ignore this
      pan: jest.fn(() => ({ x: 999, y: -999 })),  // export must ignore this
      getElementById: () => ({ length: 0 }),
      edges: () => ({ filter: () => [] }),
      ...overrides,
    } as any;
  }

  it('returns zoom=1 and pan derived from bb + padding, never reading live zoom/pan', () => {
    const cy = makeFakeCy();
    const bb = { x1: 200, y1: 100, x2: 1200, y2: 700, w: 1000, h: 600 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(ctx.zoom).toBe(1);
    expect(ctx.pan).toEqual({ x: -150, y: -50 });
    expect(cy.zoom).not.toHaveBeenCalled();
    expect(cy.pan).not.toHaveBeenCalled();
  });

  it('resolves a free anchor in PNG-pixel space (model + offset)', () => {
    const cy = makeFakeCy();
    const bb = { x1: 0, y1: 0, x2: 1000, y2: 1000, w: 1000, h: 1000 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'free', x: 100, y: 200 }, ctx))
      .toEqual({ x: 150, y: 250 });
  });

  it('resolves a node anchor from node.position() (model), NOT renderedPosition()', () => {
    const fakeNode = {
      length: 1,
      isNode: () => true,
      position: () => ({ x: 400, y: 300 }),
      renderedPosition: () => ({ x: 9999, y: 9999 }), // tripwire — must not be read
    } as any;
    const cy = makeFakeCy({ getElementById: () => fakeNode });
    const bb = { x1: 0, y1: 0, x2: 1000, y2: 1000, w: 1000, h: 1000 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'node', anchorId: 'n1', dx: 10, dy: -20 }, ctx))
      .toEqual({ x: 460, y: 330 });
  });

  it('resolves an edge anchor at midpoint + perpOffset, in PNG-pixel space', () => {
    const src = { renderedPosition: () => ({ x: 100, y: 100 }), position: () => ({ x: 100, y: 100 }) };
    const tgt = { renderedPosition: () => ({ x: 300, y: 100 }), position: () => ({ x: 300, y: 100 }) };
    const fakeEdge = { length: 1, isEdge: () => true, source: () => src, target: () => tgt } as any;
    const cy = makeFakeCy({ getElementById: () => fakeEdge });
    const bb = { x1: 0, y1: 0, x2: 400, y2: 400, w: 400, h: 400 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'edge', anchorId: 'e1', t: 0.5, perpOffset: 10 }, ctx))
      .toEqual({ x: 250, y: 140 });
  });

  it('resolves a txEdge anchor via edges().filter, in PNG-pixel space', () => {
    const src = { position: () => ({ x: 0, y: 0 }), renderedPosition: () => ({ x: 0, y: 0 }) };
    const tgt = { position: () => ({ x: 200, y: 0 }), renderedPosition: () => ({ x: 200, y: 0 }) };
    const fakeEdge = { source: () => src, target: () => tgt, data: (k: string) => (k === 'txHash' ? '0xabc' : undefined) } as any;
    const fakeMatch = { length: 1, 0: fakeEdge };
    const cy = makeFakeCy({ edges: () => ({ filter: (_pred: any) => fakeMatch }) });
    const bb = { x1: 0, y1: 0, x2: 200, y2: 200, w: 200, h: 200 } as any;
    const ctx = exportContextFromCy(cy, bb, 50);
    expect(resolveLabelRenderedPosition({ type: 'txEdge', txHash: '0xabc', t: 0.5, perpOffset: 0 }, ctx))
      .toEqual({ x: 150, y: 50 });
  });
});
