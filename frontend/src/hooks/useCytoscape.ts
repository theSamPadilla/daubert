import { useEffect, useRef, useCallback } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import { Investigation } from '../types/investigation';
import { formatTokenAmount, normalizeToken, parseTimestamp } from '../utils/formatAmount';

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatShortDate(ts: string | number): string {
  const d = parseTimestamp(ts);
  if (isNaN(d.getTime())) return '';
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export interface CytoscapeCallbacks {
  onSelectItem?: (item: any) => void;
  onMultiSelect?: (nodes: { id: string; traceId: string }[]) => void;
  onNodeDrag?: (nodeId: string, position: { x: number; y: number }) => void;
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
      'color': '#fff',
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

  // ── Address type shapes ────────────────────────────────────────────────
  {
    selector: 'node[addressType = "wallet"]',
    style: { 'shape': 'ellipse' },
  },
  {
    selector: 'node[addressType = "contract"]',
    style: {
      'shape': 'roundrectangle',
      'border-style': 'dashed',
      'border-opacity': 0.7,
      'border-width': 2,
    },
  },
  {
    selector: 'node[addressType = "exchange"]',
    style: {
      'shape': 'diamond',
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
      'font-size': '13px',
      'font-weight': 'bold',
      'color': 'data(color)',
      'text-margin-y': -4,
    },
  },
  {
    selector: ':parent[?noColor]',
    style: {
      'background-opacity': 0,
      'border-width': 0,
    },
  },

  // ── Subgroup compound ──────────────────────────────────────────────────
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

  // ── Base edge ──────────────────────────────────────────────────────────
  {
    selector: 'edge',
    style: {
      'width': 'data(weight)',
      'line-color': 'data(color)',
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
      'text-margin-y': -8,
      'text-background-color': '#111827',
      'text-background-opacity': 0.85,
      'text-background-padding': '3px',
      'text-background-shape': 'roundrectangle',
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

    // DOM overlay for edge date sublabels (smaller text below the amount)
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

        // Match the rotation of Cytoscape's autorotate label so the date
        // aligns with the edge, then shift 12 px along the perpendicular
        // (in the rotated frame) to sit just below the amount label.
        const dx = tgtPos.x - srcPos.x;
        const dy = tgtPos.y - srcPos.y;
        const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

        let el = edgeSublabelEls.get(id);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText =
            'position:absolute;font-size:8px;color:#9ca3af;white-space:nowrap;pointer-events:none;';
          overlayEl.appendChild(el);
          edgeSublabelEls.set(id, el);
        }
        // Near-vertical: keep date label horizontal to match the Cytoscape label
        const absAngle = Math.abs(angleDeg);
        const isNearVertical = absAngle > 65 && absAngle < 115;
        el.textContent = date;
        el.style.left = `${midX}px`;
        el.style.top = `${midY}px`;
        el.style.transform = isNearVertical
          ? `translate(-50%, -50%) translateY(12px)`
          : `translate(-50%, -50%) rotate(${angleDeg}deg) translateY(12px)`;
        el.style.display = '';
      });
      edgeSublabelEls.forEach((el, id) => {
        if (!activeIds.has(id)) el.style.display = 'none';
      });
    };

    cy.on('render', () => {
      updateSublabels();
      updateEdgeSublabels();
    });

    // ── Helpers ──────────────────────────────────────────────────────────
    const clearSel = () => cy.elements().removeClass('cy-sel');

    const selNodes = () => cy.nodes('.cy-sel').filter((n: any) => !n.isParent());

    const notifySelection = (inv: Investigation | null) => {
      const sel = selNodes();
      if (sel.length === 0) {
        callbacksRef.current.onSelectItem?.(null);
      } else if (sel.length === 1) {
        const n = sel[0];
        const traceId = n.data('traceId') || n.data('parent');
        const trace = inv?.traces.find((t) => t.id === traceId);
        const walletNode = trace?.nodes.find((w: any) => w.id === n.data('id'));
        if (walletNode) callbacksRef.current.onSelectItem?.({ type: 'wallet', data: walletNode });
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

      if (node.isParent()) {
        clearSel();
        if (node.data('isGroup')) {
          for (const trace of inv.traces) {
            const group = (trace.groups || []).find((g) => g.id === node.data('id'));
            if (group) { callbacksRef.current.onSelectItem?.({ type: 'group', data: group }); break; }
          }
        } else {
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
    cy.on('tap', 'edge', (event: EventObject) => {
      const edge = event.target;
      const wasSelected = edge.hasClass('cy-sel');
      clearSel();
      if (wasSelected) {
        callbacksRef.current.onSelectItem?.(null);
        return;
      }
      edge.addClass('cy-sel');
      const inv = investigationRef.current;
      if (!inv) return;
      for (const trace of inv.traces) {
        const tx = trace.edges.find((e: any) => e.id === edge.data('id'));
        if (tx) { callbacksRef.current.onSelectItem?.({ type: 'transaction', data: tx }); break; }
      }
    });

    // ── Background tap ───────────────────────────────────────────────────
    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) {
        clearSel();
        callbacksRef.current.onSelectItem?.(null);
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
            noColor: !traceColor,
            collapsed: true,
          },
          position: trace.position || { x: 0, y: 0 },
        });
      } else {
        // Parent node for trace
        targetNodes.set(trace.id, {
          data: {
            id: trace.id,
            label: trace.name,
            color: traceColor || '#3b82f6',
            noColor: !traceColor,
            collapsed: false,
          },
          position: trace.position || { x: 0, y: 0 },
        });

        // Subgroup compound nodes (nested inside trace compound)
        (trace.groups || []).forEach((group) => {
          const groupColor = group.color || traceColor || '#60a5fa';
          targetNodes.set(group.id, {
            data: {
              id: group.id,
              parent: trace.id,
              label: group.name,
              color: groupColor,
              isGroup: true,
            },
          });
        });

        // Wallet nodes
        trace.nodes.forEach((node) => {
          const addr = node.address;
          const truncAddr = addr && addr.length > 10
            ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
            : addr || '';

          const hasCustomLabel = !!(node.label
            && node.label !== addr
            && node.label !== truncAddr);

          // Custom label → show name only (address rendered via DOM overlay)
          // No custom label → show truncated address
          const displayLabel = hasCustomLabel ? node.label : (truncAddr || node.label);

          // If the node belongs to a group that exists in this trace, nest under the group;
          // otherwise nest directly under the trace.
          const groupExists = node.groupId && (trace.groups || []).some((g) => g.id === node.groupId);
          const parentId = groupExists ? node.groupId! : trace.id;

          targetNodes.set(node.id, {
            data: {
              id: node.id,
              parent: parentId,
              traceId: trace.id,
              label: node.label,
              displayLabel,
              hasCustomLabel,
              truncAddr,
              color: node.color || '#60a5fa',
              size: node.size || 60,
              addressType: node.addressType || 'unknown',
            },
            position: node.position,
          });
        });

        // Transaction edges
        trace.edges.forEach((edge) => {
          const tok = normalizeToken(edge.token);
          const amount = `${formatTokenAmount(edge.amount, tok.decimals)} ${tok.symbol}`;
          const date = formatShortDate(edge.timestamp);

          // Log-scale edge weight from human-readable amount
          const rawAmount = parseFloat(String(edge.amount)) || 0;
          const humanAmount = tok.decimals > 0 ? rawAmount / Math.pow(10, tok.decimals) : rawAmount;
          const weight = humanAmount > 0
            ? Math.min(Math.max(1.5 + Math.log10(humanAmount + 1) * 0.9, 1.5), 7)
            : 2;

          targetEdges.set(edge.id, {
            data: {
              id: edge.id,
              source: edge.from,
              target: edge.to,
              label: amount,
              date,
              color: edge.color || '#10b981',
              weight,
            },
          });
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

  return { containerRef, unselectAll };
}
