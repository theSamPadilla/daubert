// frontend/src/lib/labelGeometry.ts
import type { LabelAnchor } from '@/types/investigation';
import type { Core } from 'cytoscape';

export interface GeometryContext {
  zoom: number;
  pan?: { x: number; y: number };
  getNode?: (id: string) => { renderedPosition: () => { x: number; y: number } } | null;
  getEdge?: (id: string) => {
    source: () => { renderedPosition: () => { x: number; y: number } };
    target: () => { renderedPosition: () => { x: number; y: number } };
  } | null;
  // Resolve a transaction hash to its current cytoscape edge. Stable across bundling/aggregation.
  // If multiple visible edges share the txHash (cross-trace duplicate), prefer the first match.
  getEdgeByTxHash?: (txHash: string) => {
    source: () => { renderedPosition: () => { x: number; y: number } };
    target: () => { renderedPosition: () => { x: number; y: number } };
  } | null;
}

export function contextFromCy(cy: Core): GeometryContext {
  return {
    zoom: cy.zoom(),
    pan: cy.pan(),
    getNode: (id: string) => {
      const n = cy.getElementById(id);
      return n && n.length > 0 && n.isNode() ? n : null;
    },
    getEdge: (id: string) => {
      const e = cy.getElementById(id);
      return e && e.length > 0 && e.isEdge() ? e : null;
    },
    getEdgeByTxHash: (txHash: string) => {
      // Cytoscape edge data carries the underlying TransactionEdge's txHash for individual
      // transaction edges. Aggregated edges and bundles have no single txHash and are excluded
      // by construction. See cytoscapeSync.ts:151 — `txHash` was added in this PR specifically
      // to support txEdge anchor resolution.
      const match = cy.edges().filter((e: any) => e.data('txHash') === txHash);
      return match.length > 0 ? match[0] : null;
    },
  };
}

export function resolveLabelRenderedPosition(
  anchor: LabelAnchor,
  ctx: GeometryContext,
): { x: number; y: number } | null {
  switch (anchor.type) {
    case 'free': {
      const pan = ctx.pan ?? { x: 0, y: 0 };
      return { x: anchor.x * ctx.zoom + pan.x, y: anchor.y * ctx.zoom + pan.y };
    }
    case 'node': {
      const n = ctx.getNode?.(anchor.anchorId);
      if (!n) return null;
      const p = n.renderedPosition();
      return { x: p.x + anchor.dx * ctx.zoom, y: p.y + anchor.dy * ctx.zoom };
    }
    case 'edge':
    case 'txEdge': {
      const e = anchor.type === 'txEdge'
        ? ctx.getEdgeByTxHash?.(anchor.txHash)
        : ctx.getEdge?.(anchor.anchorId);
      if (!e) return null;
      const s = e.source().renderedPosition();
      const t = e.target().renderedPosition();
      const mx = s.x + (t.x - s.x) * anchor.t;
      const my = s.y + (t.y - s.y) * anchor.t;
      // Perpendicular unit vector. Convention: rotate edge direction by -90deg
      // (so positive perpOffset is "above" the edge in screen space, i.e. negative y for a
      // rightward horizontal edge). Perp = (dy, -dx) / len.
      const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
      const px = (t.y - s.y) / len;
      const py = -(t.x - s.x) / len;
      const off = anchor.perpOffset * ctx.zoom;
      return { x: mx + px * off, y: my + py * off };
    }
  }
}

export function modelDeltaFromRenderedDelta(
  delta: { dx: number; dy: number },
  zoom: number,
): { dx: number; dy: number } {
  return { dx: delta.dx / zoom, dy: delta.dy / zoom };
}

export function projectPointOntoEdge(
  p: { x: number; y: number },
  source: { x: number; y: number },
  target: { x: number; y: number },
): { t: number; perpOffset: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { t: 0, perpOffset: 0 };
  const tRaw = ((p.x - source.x) * dx + (p.y - source.y) * dy) / len2;
  const t = Math.max(0, Math.min(1, tRaw));
  const closestX = source.x + dx * t;
  const closestY = source.y + dy * t;
  // Signed perpendicular distance. Sign: positive means the point is on the side that
  // resolveLabelRenderedPosition places positive-perpOffset labels (i.e. above the edge in screen
  // space for a rightward horizontal edge). Formula uses 2D cross product with consistent sign.
  const len = Math.sqrt(len2);
  const perpOffset = ((p.x - closestX) * dy - (p.y - closestY) * dx) / len;
  return { t, perpOffset };
}
