import type cytoscape from 'cytoscape';
import { parseTimestamp } from '../utils/formatAmount';

// Returns '#fff' or '#111827' depending on which has better contrast against bg
export function contrastTextColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.length === 3 ? c[0] + c[0] : c.slice(0, 2), 16) / 255;
  const g = parseInt(c.length === 3 ? c[1] + c[1] : c.slice(2, 4), 16) / 255;
  const b = parseInt(c.length === 3 ? c[2] + c[2] : c.slice(4, 6), 16) / 255;
  const lin = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.4 ? '#111827' : '#ffffff';
}

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function formatShortDate(ts: string | number): string {
  const d = parseTimestamp(ts);
  if (isNaN(d.getTime())) return '';
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export const CYTOSCAPE_STYLE: cytoscape.StylesheetStyle[] = [
  // ── Base node ──────────────────────────────────────────────────────────
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'label': 'data(displayLabel)',
      'text-valign': 'center',
      'text-halign': 'center',
      'color': 'data(textColor)',
      'font-size': '11px',
      'font-weight': '600',
      'text-wrap': 'wrap',
      'text-max-width': '80px',
      'border-width': 1.5,
      'border-color': 'data(color)',
      'border-opacity': 0.35,
    },
  },
  // Only map data(size) on nodes that actually carry it (leaf nodes, collapsed groups)
  {
    selector: 'node[size]',
    style: {
      'width': 'data(size)',
      'height': 'data(size)',
    },
  },

  // ── Shape (explicit override > addressType fallback, both stored in nodeShape data) ──
  {
    selector: 'node[nodeShape]',
    style: { 'shape': 'data(nodeShape)' as any },
  },
  // Keep border styling for address types (shape is now in data)
  {
    selector: 'node[addressType = "contract"]',
    style: {
      'border-style': 'dashed',
      'border-opacity': 0.7,
      'border-width': 2,
    },
  },
  {
    selector: 'node[addressType = "exchange"]',
    style: {
      'border-opacity': 0.85,
      'border-width': 2,
    },
  },

  // ── Node states ────────────────────────────────────────────────────────
  // Yellow ring = selected (single click / shift+click multi-select)
  {
    selector: 'node.cy-sel',
    style: {
      'border-width': 3,
      'border-color': '#facc15',
      'border-opacity': 1,
      'border-style': 'solid',
    },
  },
  {
    selector: 'node:active',
    style: {
      'overlay-color': '#ffffff',
      'overlay-opacity': 0.12,
      'overlay-padding': 6,
    },
  },

  // ── Collapsed trace node ───────────────────────────────────────────────
  {
    selector: 'node[?collapsed]',
    style: {
      'shape': 'roundrectangle',
      'width': '100px',
      'height': '40px',
      'font-size': '11px',
      'background-opacity': 0.6,
    },
  },

  // ── Compound (trace group) ─────────────────────────────────────────────
  {
    selector: ':parent',
    style: {
      'background-opacity': 0.07,
      'background-color': 'data(color)',
      'border-color': 'data(color)',
      'border-width': 1.5,
      'border-opacity': 0.45,
      'label': 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': 'data(fontSize)' as any,
      'font-weight': 'bold',
      'color': 'data(color)',
      'text-margin-y': -4,
      'text-wrap': 'none',
      'text-max-width': '2000px',
      'padding': '50px',
    },
  },
  {
    selector: ':parent[?noColor]',
    style: {
      'background-opacity': 0,
      'border-width': 0,
    },
  },

  // ── Subgroup compound (expanded) ───────────────────────────────────────
  {
    selector: 'node[?isGroup]',
    style: {
      'background-opacity': 0.12,
      'border-style': 'dashed',
      'border-width': 1.5,
      'border-opacity': 0.7,
      'font-size': '11px',
      'font-weight': '600',
      'text-margin-y': -3,
    },
  },
  {
    selector: 'node[?isGroup][?noColor]',
    style: {
      'background-opacity': 0,
      'border-width': 0,
    },
  },
  // ── Subgroup collapsed (leaf node) ─────────────────────────────────────
  {
    selector: 'node[?isCollapsedGroup]',
    style: {
      'shape': 'roundrectangle',
      'border-style': 'solid',
      'border-width': 3,
      'border-opacity': 1,
      'background-opacity': 0.8,
      'font-size': '10px',
      'text-wrap': 'wrap',
      'text-max-width': '80px',
      'width': 'data(size)',
      'height': 'data(size)',
    },
  },

  // ── Base edge ──────────────────────────────────────────────────────────
  {
    selector: 'edge',
    style: {
      'width': 'data(weight)',
      'line-color': 'data(color)',
      'line-style': 'data(lineStyle)' as any,
      'target-arrow-color': 'data(color)',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'curve-style': 'bezier',
      'control-point-step-size': 40,
      'opacity': 0.65,
      'label': 'data(label)',
      'font-size': '10px',
      'color': '#d1d5db',
      'text-wrap': 'wrap',
      'text-max-width': '160px',
      'text-rotation': 'autorotate',
      'text-margin-y': -10,
      'text-background-color': '#111827',
      'text-background-opacity': 0.85,
      'text-background-padding': '3px',
      'text-background-shape': 'roundrectangle',
    },
  },

  // Manually arced edges switch to unbundled-bezier so control-point-distances is respected
  {
    selector: 'edge[hasArc]',
    style: {
      'curve-style': 'unbundled-bezier' as any,
      'control-point-distances': 'data(arcOffset)' as any,
      'control-point-weights': 0.5 as any,
    },
  },

  // Near-vertical edges: keep label horizontal so it stays readable
  {
    selector: 'edge.near-vertical',
    style: {
      'text-rotation': 0 as any,
      'text-margin-y': -8,
    },
  },

  // ── Bundle edge ────────────────────────────────────────────────────────
  {
    selector: 'edge[?isBundleEdge]',
    style: {
      'line-style': 'solid',
      'width': 5,
      'opacity': 0.9,
      'font-size': '11px',
      'font-weight': '600' as any,
      'color': '#fde68a',
    },
  },

  // ── Edge states ────────────────────────────────────────────────────────
  // Selected edges keep their own color but get a visible underlay glow
  {
    selector: 'edge.cy-sel',
    style: {
      'opacity': 1,
      'underlay-color': '#facc15',
      'underlay-opacity': 0.35,
      'underlay-padding': 4,
    } as any,
  },
  {
    selector: 'edge.hovered',
    style: { 'opacity': 1 },
  },
];
