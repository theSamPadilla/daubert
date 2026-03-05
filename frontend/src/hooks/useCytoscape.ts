import { useEffect, useRef, useCallback } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import { Investigation } from '../types/investigation';
import { formatTokenAmount } from '../utils/formatAmount';

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatShortDate(iso: string): string {
  const d = new Date(iso);
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
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'label': 'data(displayLabel)',
      'text-valign': 'center',
      'text-halign': 'center',
      'color': '#fff',
      'font-size': '11px',
      'text-wrap': 'wrap',
      'text-max-width': '80px',
      'width': 'data(size)',
      'height': 'data(size)',
    },
  },
  {
    selector: 'edge',
    style: {
      'width': 2,
      'line-color': 'data(color)',
      'target-arrow-color': 'data(color)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'label': 'data(label)',
      'font-size': '10px',
      'color': '#d1d5db',
      'text-wrap': 'wrap',
      'text-max-width': '200px',
      'text-rotation': 'autorotate',
      'text-margin-y': -8,
      'text-background-color': '#1f2937',
      'text-background-opacity': 0.8,
      'text-background-padding': '3px',
      'text-background-shape': 'roundrectangle',
    },
  },
  {
    selector: ':parent',
    style: {
      'background-opacity': 0.2,
      'background-color': 'data(color)',
      'border-color': 'data(color)',
      'border-width': 2,
      'label': 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'font-size': '14px',
      'font-weight': 'bold',
      'color': '#fff',
    },
  },
  {
    selector: ':parent[?noColor]',
    style: {
      'background-opacity': 0,
      'border-width': 0,
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 3,
      'border-color': '#facc15',
      'border-opacity': 1,
    },
  },
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

        let el = edgeSublabelEls.get(id);
        if (!el) {
          el = document.createElement('div');
          el.style.cssText =
            'position:absolute;font-size:8px;color:#9ca3af;white-space:nowrap;pointer-events:none;transform:translate(-50%, 0);';
          overlayEl.appendChild(el);
          edgeSublabelEls.set(id, el);
        }
        el.textContent = date;
        el.style.left = `${midX}px`;
        el.style.top = `${midY + 2}px`;
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

    // Click handlers using refs for latest state
    cy.on('tap', 'node', (event: EventObject) => {
      const node = event.target;
      const inv = investigationRef.current;
      if (!inv) return;

      if (node.isParent()) {
        // Trace group tap: clear selection, show trace details
        cy.nodes().unselect();
        const trace = inv.traces.find((t) => t.id === node.data('id'));
        callbacksRef.current.onSelectItem?.({ type: 'trace', data: trace });
        return;
      }

      if (!event.originalEvent.shiftKey) {
        // Normal click: clear multi-select, select only this node
        cy.elements().unselect();
        node.select();
      }
      // Shift+click: Cytoscape's additive mode handles toggle
    });

    cy.on('tap', 'edge', (event: EventObject) => {
      cy.nodes().unselect();
      const edge = event.target;
      const data = edge.data();
      const inv = investigationRef.current;
      if (!inv) return;

      for (const trace of inv.traces) {
        const tx = trace.edges.find((e: any) => e.id === data.id);
        if (tx) {
          callbacksRef.current.onSelectItem?.({ type: 'transaction', data: tx });
          break;
        }
      }
    });

    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) {
        cy.elements().unselect();
        callbacksRef.current.onSelectItem?.(null);
      }
    });

    // Unified selection sync: drives both single-select and multi-select
    cy.on('select unselect', 'node', () => {
      const selected = cy.nodes(':selected').filter((n: any) => !n.isParent());
      const inv = investigationRef.current;

      if (selected.length === 0) {
        // Don't clear — let tap handlers drive onSelectItem(null)
      } else if (selected.length === 1) {
        const n = selected[0];
        if (inv) {
          const trace = inv.traces.find((t) => t.id === n.data('parent'));
          const walletNode = trace?.nodes.find((w: any) => w.id === n.data('id'));
          if (walletNode) {
            callbacksRef.current.onSelectItem?.({ type: 'wallet', data: walletNode });
          }
        }
      } else {
        // 2+ nodes: call onMultiSelect
        callbacksRef.current.onMultiSelect?.(
          selected.map((n: any) => ({ id: n.data('id'), traceId: n.data('parent') }))
        );
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

          targetNodes.set(node.id, {
            data: {
              id: node.id,
              parent: trace.id,
              label: node.label,
              displayLabel,
              hasCustomLabel,
              truncAddr,
              color: node.color || '#60a5fa',
              size: node.size || 60,
            },
            position: node.position,
          });
        });

        // Transaction edges
        trace.edges.forEach((edge) => {
          const amount = `${formatTokenAmount(edge.amount, edge.token.decimals)} ${edge.token.symbol}`;
          const date = formatShortDate(edge.timestamp);

          targetEdges.set(edge.id, {
            data: {
              id: edge.id,
              source: edge.from,
              target: edge.to,
              label: amount,
              date,
              color: edge.color || '#10b981',
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
        // Update data
        const curData = existing.data();
        for (const [key, val] of Object.entries(target.data)) {
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

  return { containerRef, cy: cyRef.current };
}
