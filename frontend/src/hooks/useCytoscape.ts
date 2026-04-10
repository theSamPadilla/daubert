import { useEffect, useRef, useCallback } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import { Investigation } from '../types/investigation';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '../utils/formatAmount';

// Returns '#fff' or '#111827' depending on which has better contrast against bg
function contrastTextColor(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.length === 3 ? c[0] + c[0] : c.slice(0, 2), 16) / 255;
  const g = parseInt(c.length === 3 ? c[1] + c[1] : c.slice(2, 4), 16) / 255;
  const b = parseInt(c.length === 3 ? c[2] + c[2] : c.slice(4, 6), 16) / 255;
  const lin = (v: number) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.4 ? '#111827' : '#ffffff';
}

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatShortDate(ts: string | number): string {
  const d = parseTimestamp(ts);
  if (isNaN(d.getTime())) return '';
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export interface CytoscapeCallbacks {
  onSelectItem?: (item: any) => void;
  onMultiSelect?: (nodes: { id: string; traceId: string }[]) => void;
  onMultiSelectEdges?: (edgeIds: string[]) => void;
  onNodeDrag?: (nodeId: string, position: { x: number; y: number }) => void;
  onResizeNode?: (nodeId: string, traceId: string, size: number) => void;
  onContextMenu?: (event: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => void;
  onDoubleClickBackground?: (position: { x: number; y: number }) => void;
}

const CYTOSCAPE_STYLE: cytoscape.StylesheetStyle[] = [
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
      'width': 'data(size)',
      'height': 'data(size)',
      'border-width': 1.5,
      'border-color': 'data(color)',
      'border-opacity': 0.35,
    },
  },

  // ── Shape (explicit override > addressType fallback, both stored in nodeShape data) ──
  {
    selector: 'node',
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
  {
    selector: 'edge.cy-sel',
    style: {
      'line-color': '#facc15',
      'target-arrow-color': '#facc15',
      'opacity': 1,
      'width': 4,
    },
  },
  {
    selector: 'edge.hovered',
    style: { 'opacity': 1 },
  },
];

export function useCytoscape(
  investigation: Investigation | null,
  callbacks: CytoscapeCallbacks = {}
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const callbacksRef = useRef(callbacks);
  const investigationRef = useRef(investigation);

  // Keep refs updated
  callbacksRef.current = callbacks;
  investigationRef.current = investigation;

  // Init effect — runs once
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: CYTOSCAPE_STYLE,
      layout: { name: 'preset' },
      selectionType: 'additive',
      minZoom: 0.15,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });

    cyRef.current = cy;

    // DOM overlay for address sublabels (smaller text below custom-labeled nodes)
    const overlayEl = document.createElement('div');
    overlayEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    containerRef.current.parentElement?.appendChild(overlayEl);
    const sublabelEls = new Map<string, HTMLDivElement>();

    const updateSublabels = () => {
      const activeIds = new Set<string>();
      cy.nodes().forEach((n) => {
        if (n.isParent() || !n.data('hasCustomLabel')) return;
        const id = n.data('id');
        activeIds.add(id);
        const pos = n.renderedPosition();
        const h = n.renderedOuterHeight();

        let el = sublabelEls.get(id);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText =
            'position:absolute;font-size:8px;color:#9ca3af;white-space:nowrap;pointer-events:none;transform:translateX(-50%);font-family:ui-monospace,SFMono-Regular,monospace;';
          overlayEl.appendChild(el);
          sublabelEls.set(id, el);
        }
        el.textContent = n.data('truncAddr');
        el.style.left = `${pos.x}px`;
        el.style.top = `${pos.y + h / 2 + 2}px`;
        el.style.display = '';
      });
      sublabelEls.forEach((el, id) => {
        if (!activeIds.has(id)) el.style.display = 'none';
      });
    };

    // DOM overlay for edge date sublabels — smaller, dimmer text below the amount
    const edgeSublabelEls = new Map<string, HTMLDivElement>();

    const updateEdgeSublabels = () => {
      const activeIds = new Set<string>();
      cy.edges().forEach((e) => {
        const date = e.data('date');
        if (!date) return;
        const id = e.data('id');
        activeIds.add(id);

        const srcPos = e.source().renderedPosition();
        const tgtPos = e.target().renderedPosition();
        const midX = (srcPos.x + tgtPos.x) / 2;
        const midY = (srcPos.y + tgtPos.y) / 2;
        const dx = tgtPos.x - srcPos.x;
        const dy = tgtPos.y - srcPos.y;
        const rawAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        // Match Cytoscape autorotate: flip angles that would render upside-down
        const angleDeg = rawAngle > 90 ? rawAngle - 180 : rawAngle < -90 ? rawAngle + 180 : rawAngle;
        const absAngle = Math.abs(rawAngle);
        const isNearVertical = absAngle > 65 && absAngle < 115;

        let el = edgeSublabelEls.get(id);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText =
            'position:absolute;font-size:8px;color:#6b7280;white-space:nowrap;pointer-events:none;' +
            'background:#111827;padding:1px 3px;border-radius:3px;';
          overlayEl.appendChild(el);
          edgeSublabelEls.set(id, el);
        }
        el.textContent = date;
        el.style.left = `${midX}px`;
        el.style.top  = `${midY}px`;
        // 8px below the amount in the rotated frame; stay horizontal when near-vertical
        el.style.transform = isNearVertical
          ? `translate(-50%, -50%) translateY(8px)`
          : `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(8px)`;
        el.style.display = '';
      });
      edgeSublabelEls.forEach((el, id) => {
        if (!activeIds.has(id)) el.style.display = 'none';
      });
    };

    const updateEdgeOrientations = () => {
      cy.edges().forEach((e) => {
        const src = e.source().renderedPosition();
        const tgt = e.target().renderedPosition();
        if (!src || !tgt) return;
        const absAngle = Math.abs(Math.atan2(tgt.y - src.y, tgt.x - src.x) * 180 / Math.PI);
        const isNearVertical = absAngle > 65 && absAngle < 115;
        if (isNearVertical) e.addClass('near-vertical');
        else e.removeClass('near-vertical');
      });
    };

    // ── Resize handle ────────────────────────────────────────────────────
    const resizeHandleEl = document.createElement('div');
    resizeHandleEl.style.cssText =
      'position:absolute;width:10px;height:10px;background:#facc15;border:1.5px solid #fff;' +
      'border-radius:2px;cursor:se-resize;display:none;pointer-events:auto;z-index:10;' +
      'box-shadow:0 1px 3px rgba(0,0,0,0.5);';
    overlayEl.appendChild(resizeHandleEl);

    const updateResizeHandle = () => {
      const selected = cy.nodes('.cy-sel').filter((n: any) => !n.isParent());
      if (selected.length !== 1) { resizeHandleEl.style.display = 'none'; return; }
      const node = selected[0];
      const pos = node.renderedPosition();
      const w = node.renderedOuterWidth();
      const h = node.renderedOuterHeight();
      resizeHandleEl.style.left = `${pos.x + w / 2 - 5}px`;
      resizeHandleEl.style.top  = `${pos.y + h / 2 - 5}px`;
      resizeHandleEl.style.display = '';
    };

    resizeHandleEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const selected = cy.nodes('.cy-sel').filter((n: any) => !n.isParent());
      if (selected.length !== 1) return;
      const node = selected[0];
      const nodeId = node.data('id');
      const traceId = node.data('traceId') || node.data('parent');
      const containerRect = containerRef.current!.getBoundingClientRect();

      const onMove = (ev: MouseEvent) => {
        const n = cy.getElementById(nodeId);
        const center = n.renderedPosition();
        const mx = ev.clientX - containerRect.left;
        const my = ev.clientY - containerRect.top;
        const radius = Math.max(Math.abs(mx - center.x), Math.abs(my - center.y));
        // Convert rendered radius back to model size, clamp to sensible range
        const newSize = Math.round(Math.min(Math.max((radius * 2) / cy.zoom(), 20), 300));
        n.data('size', newSize);
        updateResizeHandle();
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        const finalSize = cy.getElementById(nodeId).data('size') as number;
        callbacksRef.current.onResizeNode?.(nodeId, traceId, finalSize);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    cy.on('render', () => {
      updateEdgeOrientations();
      updateSublabels();
      updateEdgeSublabels();
      updateResizeHandle();
    });

    // ── Helpers ──────────────────────────────────────────────────────────
    const clearSel = () => cy.elements().removeClass('cy-sel');

    // Include group compound nodes (isGroup) but exclude trace compound nodes
    const selNodes = () => cy.nodes('.cy-sel').filter((n: any) => !n.isParent() || n.data('isGroup'));

    const notifySelection = (inv: Investigation | null) => {
      const sel = selNodes();
      if (sel.length === 0) {
        callbacksRef.current.onSelectItem?.(null);
      } else if (sel.length === 1) {
        const n = sel[0];
        const traceId = n.data('traceId') || n.data('parent');
        if (n.data('isGroup') || n.data('isCollapsedGroup')) {
          for (const trace of inv?.traces || []) {
            const group = (trace.groups || []).find((g) => g.id === n.data('id'));
            if (group) { callbacksRef.current.onSelectItem?.({ type: 'group', data: group }); break; }
          }
        } else {
          const trace = inv?.traces.find((t) => t.id === traceId);
          const walletNode = trace?.nodes.find((w: any) => w.id === n.data('id'));
          if (walletNode) callbacksRef.current.onSelectItem?.({ type: 'wallet', data: walletNode });
        }
      } else {
        callbacksRef.current.onMultiSelect?.(
          sel.map((n: any) => ({ id: n.data('id'), traceId: n.data('traceId') || n.data('parent') }))
        );
      }
    };

    // ── Node tap ─────────────────────────────────────────────────────────
    cy.on('tap', 'node', (event: EventObject) => {
      const node = event.target;
      const inv = investigationRef.current;
      if (!inv) return;

      if (node.data('isCollapsedGroup')) {
        if (event.originalEvent.shiftKey) {
          // Shift+click: toggle collapsed group into/out of multi-select
          if (node.hasClass('cy-sel')) node.removeClass('cy-sel');
          else node.addClass('cy-sel');
          notifySelection(inv);
        } else {
          const wasSoloSel = node.hasClass('cy-sel') && selNodes().length === 1;
          clearSel();
          if (wasSoloSel) {
            callbacksRef.current.onSelectItem?.(null);
          } else {
            node.addClass('cy-sel');
            for (const trace of inv.traces) {
              const group = (trace.groups || []).find((g) => g.id === node.data('id'));
              if (group) { callbacksRef.current.onSelectItem?.({ type: 'group', data: group }); break; }
            }
          }
        }
        return;
      }

      if (node.isParent()) {
        if (node.data('isGroup') && event.originalEvent.shiftKey) {
          // Shift+click expanded group: toggle into multi-select
          if (node.hasClass('cy-sel')) node.removeClass('cy-sel');
          else node.addClass('cy-sel');
          notifySelection(inv);
        } else if (node.data('isGroup')) {
          // Single click expanded group: solo select / open details
          const wasSoloSel = node.hasClass('cy-sel') && selNodes().length === 1;
          clearSel();
          if (wasSoloSel) {
            callbacksRef.current.onSelectItem?.(null);
          } else {
            node.addClass('cy-sel');
            for (const trace of inv.traces) {
              const group = (trace.groups || []).find((g) => g.id === node.data('id'));
              if (group) { callbacksRef.current.onSelectItem?.({ type: 'group', data: group }); break; }
            }
          }
        } else {
          // Trace compound node
          clearSel();
          const trace = inv.traces.find((t) => t.id === node.data('id'));
          callbacksRef.current.onSelectItem?.({ type: 'trace', data: trace });
        }
        return;
      }

      if (event.originalEvent.shiftKey) {
        // Shift+click: toggle in/out of multi-select
        if (node.hasClass('cy-sel')) {
          node.removeClass('cy-sel');
        } else {
          node.addClass('cy-sel');
        }
        notifySelection(inv);
      } else {
        // Single click: toggle solo select / open details
        const wasSoloSel = node.hasClass('cy-sel') && selNodes().length === 1;
        clearSel();
        if (wasSoloSel) {
          callbacksRef.current.onSelectItem?.(null);
        } else {
          node.addClass('cy-sel');
          notifySelection(inv);
        }
      }
    });

    // ── Edge tap ─────────────────────────────────────────────────────────
    const selEdges = () => cy.edges('.cy-sel');

    const notifyEdgeSelection = (inv: Investigation | null) => {
      const sel = selEdges();
      if (sel.length === 0) {
        callbacksRef.current.onSelectItem?.(null);
      } else if (sel.length === 1) {
        const e = sel[0];
        if (e.data('isBundleEdge')) {
          for (const trace of inv?.traces || []) {
            const bundle = (trace.edgeBundles || []).find((b) => b.id === e.data('id'));
            if (bundle) { callbacksRef.current.onSelectItem?.({ type: 'edgeBundle', data: bundle }); break; }
          }
        } else {
          for (const trace of inv?.traces || []) {
            const tx = trace.edges.find((edge: any) => edge.id === e.data('id'));
            if (tx) { callbacksRef.current.onSelectItem?.({ type: 'transaction', data: tx }); break; }
          }
        }
      } else {
        callbacksRef.current.onMultiSelectEdges?.(sel.map((e: any) => e.data('id')));
      }
    };

    cy.on('tap', 'edge', (event: EventObject) => {
      const edge = event.target;
      const inv = investigationRef.current;

      if (event.originalEvent.shiftKey) {
        // Shift+click: toggle edge into/out of multi-select (clear any node sel)
        cy.nodes().removeClass('cy-sel');
        if (edge.hasClass('cy-sel')) edge.removeClass('cy-sel');
        else edge.addClass('cy-sel');
        notifyEdgeSelection(inv);
      } else {
        const wasSelected = edge.hasClass('cy-sel') && selEdges().length === 1;
        clearSel();
        if (wasSelected) {
          callbacksRef.current.onSelectItem?.(null);
          return;
        }
        edge.addClass('cy-sel');
        notifyEdgeSelection(inv);
      }
    });

    // ── Background tap ───────────────────────────────────────────────────
    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) {
        clearSel();
        callbacksRef.current.onSelectItem?.(null);
      }
    });

    // ── Box / rubber-band selection ───────────────────────────────────────
    // After a shift+drag box select, Cytoscape has natively selected the nodes.
    // Sync those into cy-sel (additive — preserves existing cy-sel), then clear
    // Cytoscape's native selected state so it doesn't interfere with tap logic.
    cy.on('boxend', () => {
      const selectedNodes = cy.nodes(':selected').filter((n: any) => !n.isParent() || n.data('isGroup'));
      const selectedEdges = cy.edges(':selected');
      selectedNodes.forEach((n: any) => n.addClass('cy-sel'));
      selectedEdges.forEach((e: any) => e.addClass('cy-sel'));
      cy.elements().unselect();
      // If ≥2 edges are in the selection (nodes may be incidentally caught since
      // they're endpoints of the edges), treat this as an edge multi-select.
      if (selEdges().length >= 2) {
        cy.nodes().removeClass('cy-sel');
        notifyEdgeSelection(investigationRef.current);
      } else {
        notifySelection(investigationRef.current);
      }
    });

    // Drag handler
    cy.on('dragfree', 'node', (event: EventObject) => {
      const node = event.target;
      if (node.isParent()) return;
      const pos = node.position();
      callbacksRef.current.onNodeDrag?.(node.data('id'), { x: pos.x, y: pos.y });
    });

    // Context menu handlers
    cy.on('cxttap', 'node', (event: EventObject) => {
      const node = event.target;
      const renderedPos = event.renderedPosition || event.position;
      const containerRect = containerRef.current!.getBoundingClientRect();
      callbacksRef.current.onContextMenu?.({
        type: 'node',
        id: node.data('id'),
        x: containerRect.left + renderedPos.x,
        y: containerRect.top + renderedPos.y,
      });
    });

    cy.on('cxttap', 'edge', (event: EventObject) => {
      const edge = event.target;
      const renderedPos = event.renderedPosition || event.position;
      const containerRect = containerRef.current!.getBoundingClientRect();
      callbacksRef.current.onContextMenu?.({
        type: 'edge',
        id: edge.data('id'),
        x: containerRect.left + renderedPos.x,
        y: containerRect.top + renderedPos.y,
      });
    });

    cy.on('cxttap', (event: EventObject) => {
      if (event.target === cy) {
        const renderedPos = event.renderedPosition || event.position;
        const containerRect = containerRef.current!.getBoundingClientRect();
        callbacksRef.current.onContextMenu?.({
          type: 'background',
          x: containerRect.left + renderedPos.x,
          y: containerRect.top + renderedPos.y,
        });
      }
    });

    // Double-click background for creating wallets
    cy.on('dbltap', (event: EventObject) => {
      if (event.target === cy) {
        const pos = event.position;
        callbacksRef.current.onDoubleClickBackground?.({ x: pos.x, y: pos.y });
      }
    });

    // Edge hover highlight
    cy.on('mouseover', 'edge', (event: EventObject) => {
      event.target.addClass('hovered');
    });
    cy.on('mouseout', 'edge', (event: EventObject) => {
      event.target.removeClass('hovered');
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
      overlayEl.remove();
      sublabelEls.clear();
      edgeSublabelEls.clear();
    };
  }, []); // Only init once

  // Sync effect — diffs investigation data into Cytoscape
  const syncToCytoscape = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const inv = investigation;
    if (!inv) {
      cy.elements().remove();
      return;
    }

    // Build target element maps
    const targetNodes = new Map<string, any>();
    const targetEdges = new Map<string, any>();

    inv.traces.forEach((trace) => {
      if (!trace.visible) return;

      const traceColor = trace.color || '';

      if (trace.collapsed) {
        // Collapsed trace: single node with wallet count label
        targetNodes.set(trace.id, {
          data: {
            id: trace.id,
            label: `${trace.name} (${trace.nodes.length})`,
            color: traceColor || '#3b82f6',
            textColor: contrastTextColor(traceColor || '#3b82f6'),
            noColor: !traceColor,
            collapsed: true,
          },
          position: trace.position || { x: 0, y: 0 },
        });
      } else {
        // Parent node for trace — font size scales with node count
        const traceFontSize = Math.round(Math.min(Math.max(12 + Math.sqrt(trace.nodes.length) * 2.5, 12), 36));
        targetNodes.set(trace.id, {
          data: {
            id: trace.id,
            label: trace.name,
            color: traceColor || '#3b82f6',
            noColor: !traceColor,
            collapsed: false,
            fontSize: traceFontSize,
          },
          position: trace.position || { x: 0, y: 0 },
        });

        // Build map of nodeId → groupId for collapsed groups
        const collapsedGroupOf = new Map<string, string>();
        (trace.groups || []).forEach((group) => {
          if (group.collapsed) {
            trace.nodes.forEach((n) => { if (n.groupId === group.id) collapsedGroupOf.set(n.id, group.id); });
          }
        });

        // Group nodes (compound if expanded, leaf node if collapsed)
        (trace.groups || []).forEach((group) => {
          const groupColor = group.color || traceColor || '#60a5fa';
          if (group.collapsed) {
            const gMembers = trace.nodes.filter((n) => n.groupId === group.id);
            const cx = gMembers.reduce((s, n) => s + n.position.x, 0) / (gMembers.length || 1);
            const cy2 = gMembers.reduce((s, n) => s + n.position.y, 0) / (gMembers.length || 1);
            targetNodes.set(group.id, {
              data: { id: group.id, parent: trace.id, traceId: trace.id, label: group.name, displayLabel: `${group.name} (${gMembers.length})`, color: groupColor, textColor: contrastTextColor(groupColor), size: group.size || 70, isCollapsedGroup: true },
              position: { x: cx, y: cy2 },
            });
          } else {
            targetNodes.set(group.id, {
              data: { id: group.id, parent: trace.id, label: group.name, color: groupColor, isGroup: true },
            });
          }
        });

        // Wallet nodes (skip members of collapsed groups)
        trace.nodes.forEach((node) => {
          if (collapsedGroupOf.has(node.id)) return;
          const addr = node.address;
          const truncAddr = addr && addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || '';
          const hasCustomLabel = !!(node.label && node.label !== addr && node.label !== truncAddr);
          const displayLabel = hasCustomLabel ? node.label : (truncAddr || node.label);
          const groupExists = node.groupId && (trace.groups || []).some((g) => g.id === node.groupId && !g.collapsed);
          const parentId = groupExists ? node.groupId! : trace.id;
          const nodeColor = node.color || '#60a5fa';
          const addrTypeShape = node.addressType === 'contract' ? 'roundrectangle' : node.addressType === 'exchange' ? 'diamond' : 'ellipse';
          const nodeShape = node.shape || addrTypeShape;
          targetNodes.set(node.id, {
            data: { id: node.id, parent: parentId, traceId: trace.id, label: node.label, displayLabel, hasCustomLabel, truncAddr, color: nodeColor, textColor: contrastTextColor(nodeColor), size: node.size || 60, addressType: node.addressType || 'unknown', nodeShape },
            position: node.position,
          });
        });

        // Edges — re-route & aggregate for collapsed groups, skip bundled edges
        const edgeW = (h: number) => h > 0 ? Math.min(Math.max(1.5 + Math.pow(h, 0.2) * 0.28, 1.5), 14) : 1.5;
        const abbr = (h: number) => h >= 1e6 ? `${(h/1e6).toFixed(1)}M` : h >= 1e3 ? `${(h/1e3).toFixed(1)}K` : h.toFixed(1);

        // Build collapsed bundle index
        const bundledEdgeIds = new Set<string>();
        (trace.edgeBundles || []).forEach((bundle) => {
          if (bundle.collapsed) bundle.edgeIds.forEach((id) => bundledEdgeIds.add(id));
        });

        const aggEdges = new Map<string, { src: string; tgt: string; human: number; sym: string; color: string; date: string; n: number }>();

        trace.edges.forEach((edge) => {
          if (bundledEdgeIds.has(edge.id)) return; // rendered as bundle edge below
          const effFrom = collapsedGroupOf.get(edge.from) ?? edge.from;
          const effTo   = collapsedGroupOf.get(edge.to)   ?? edge.to;
          if (effFrom === effTo) return;
          const tok = normalizeToken(edge.token);
          const raw = parseFloat(String(edge.amount)) || 0;
          const human = tok.decimals > 0 ? raw / Math.pow(10, tok.decimals) : raw;
          if (effFrom !== edge.from || effTo !== edge.to) {
            const key = `${effFrom}::${effTo}::${tok.symbol}`;
            const ex = aggEdges.get(key);
            if (ex) { ex.human += human; ex.n++; }
            else aggEdges.set(key, { src: effFrom, tgt: effTo, human, sym: tok.symbol, color: edge.color || '#10b981', date: formatShortDate(edge.timestamp), n: 1 });
          } else {
            const amountLabel = `${formatTokenAmount(edge.amount, tok.decimals)} ${tok.symbol}`;
            const label = edge.label || amountLabel;
            const date = formatShortDate(edge.timestamp);
            targetEdges.set(edge.id, { data: { id: edge.id, source: edge.from, target: edge.to, label, date, color: edge.color || '#10b981', lineStyle: edge.lineStyle || 'solid', weight: edgeW(human) } });
          }
        });

        aggEdges.forEach((a, key) => {
          const label = `${abbr(a.human)} ${a.sym}${a.n > 1 ? ` (${a.n})` : ''}`;
          targetEdges.set(key, { data: { id: key, source: a.src, target: a.tgt, label, date: a.date, color: a.color, lineStyle: 'solid', weight: edgeW(a.human) } });
        });

        // Render collapsed bundles as single aggregated edges
        (trace.edgeBundles || []).forEach((bundle) => {
          if (!bundle.collapsed) return;
          const bundleEdges = bundle.edgeIds.map((id) => trace.edges.find((e) => e.id === id)).filter(Boolean) as any[];
          if (bundleEdges.length === 0) return;
          // Sum per-edge using each edge's own token decimals
          let totalHuman = 0;
          let labelSym = bundle.token;
          bundleEdges.forEach((e, i) => {
            const tok = normalizeToken(e.token);
            if (i === 0) labelSym = tok.symbol;
            const raw = parseFloat(String(e.amount)) || 0;
            totalHuman += tok.decimals > 0 ? raw / Math.pow(10, tok.decimals) : raw;
          });
          const label = `${abbr(totalHuman)} ${labelSym} (${bundleEdges.length})`;
          const color = bundleEdges[0].color || '#f59e0b';
          targetEdges.set(bundle.id, { data: { id: bundle.id, source: bundle.fromNodeId, target: bundle.toNodeId, label, date: '', color, weight: edgeW(totalHuman), isBundleEdge: true } });
        });
      }
    });

    // Remove elements not in target
    cy.nodes().forEach((ele) => {
      if (!targetNodes.has(ele.data('id'))) {
        ele.remove();
      }
    });
    cy.edges().forEach((ele) => {
      if (!targetEdges.has(ele.data('id'))) {
        ele.remove();
      }
    });

    // Add/update nodes
    targetNodes.forEach((target, id) => {
      const existing = cy.getElementById(id);
      if (existing.length > 0) {
        // Update data — but 'parent' is structural in Cytoscape and cannot be
        // changed via .data(). Use .move() to reparent, and remove+re-add if
        // the position also needs to change (e.g. after trace extraction).
        const curData = existing.data();
        if ('parent' in target.data && curData.parent !== target.data.parent) {
          // Reparent: move to new compound parent then re-add at correct position
          existing.move({ parent: (target.data as any).parent ?? null });
          if (target.position) {
            existing.position(target.position);
          }
        }
        for (const [key, val] of Object.entries(target.data)) {
          if (key === 'parent') continue; // handled above via .move()
          if (curData[key] !== val) {
            existing.data(key, val);
          }
        }
      } else {
        // Add new node
        cy.add({ group: 'nodes', ...target });
      }
    });

    // Add/update edges
    targetEdges.forEach((target, id) => {
      const existing = cy.getElementById(id);
      if (existing.length > 0) {
        const curData = existing.data();
        for (const [key, val] of Object.entries(target.data)) {
          if (curData[key] !== val) {
            existing.data(key, val);
          }
        }
      } else {
        cy.add({ group: 'edges', ...target });
      }
    });
  }, [investigation]);

  useEffect(() => {
    syncToCytoscape();
  }, [syncToCytoscape]);

  // Fit on first load
  const hasInitialFit = useRef(false);
  useEffect(() => {
    const cy = cyRef.current;
    if (cy && investigation && !hasInitialFit.current) {
      // Small delay to let elements render
      const timer = setTimeout(() => {
        if (!cy.destroyed() && cy.elements().length > 0) {
          cy.fit(undefined, 50);
          hasInitialFit.current = true;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [investigation]);

  const unselectAll = useCallback(() => {
    cyRef.current?.elements().removeClass('cy-sel');
  }, []);

  const exportImage = useCallback((format: 'png' | 'pdf', filename = 'graph') => {
    const cy = cyRef.current;
    if (!cy) return;
    const dataUrl = cy.png({ full: true, scale: 2, bg: '#111827' });
    if (format === 'png') {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${filename}.png`;
      a.click();
    } else {
      const win = window.open('', '_blank');
      if (!win) return;
      win.document.write(`<!DOCTYPE html><html><head><title>${filename}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #111827; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
        img { max-width: 100%; max-height: 100vh; object-fit: contain; }
        @media print { body { background: white; } img { max-width: 100%; max-height: 100%; page-break-inside: avoid; } }
      </style></head><body><img src="${dataUrl}" /></body></html>`);
      win.document.close();
      win.addEventListener('load', () => win.print());
    }
  }, []);

  const setEdgeArc = useCallback((edgeId: string, delta: number | null) => {
    const cy = cyRef.current;
    if (!cy) return;
    const edge = cy.getElementById(edgeId);
    if (!edge || edge.length === 0) return;
    if (delta === null) {
      // Reset: remove arc, fall back to auto bezier fanning
      edge.removeData('arcOffset');
      edge.removeData('hasArc');
    } else {
      const next = ((edge.data('arcOffset') as number) || 0) + delta;
      edge.data('arcOffset', next);
      edge.data('hasArc', true);
    }
  }, []);

  return { containerRef, unselectAll, exportImage, setEdgeArc };
}
