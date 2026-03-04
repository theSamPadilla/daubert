import { useEffect, useRef, useCallback } from 'react';
import cytoscape, { Core, EventObject } from 'cytoscape';
import { Investigation } from '../types/investigation';

export interface CytoscapeCallbacks {
  onSelectItem?: (item: any) => void;
  onNodeDrag?: (nodeId: string, position: { x: number; y: number }) => void;
  onContextMenu?: (event: { type: 'node' | 'edge' | 'background'; id?: string; x: number; y: number }) => void;
  onDoubleClickBackground?: (position: { x: number; y: number }) => void;
}

const CYTOSCAPE_STYLE: cytoscape.StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'label': 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'color': '#fff',
      'font-size': '12px',
      'width': '60px',
      'height': '60px',
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
      'color': '#fff',
      'text-rotation': 'autorotate',
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
    });

    cyRef.current = cy;

    // Click handlers using refs for latest state
    cy.on('tap', 'node', (event: EventObject) => {
      const node = event.target;
      const data = node.data();
      const inv = investigationRef.current;
      if (!inv) return;

      if (node.isParent()) {
        const trace = inv.traces.find((t) => t.id === data.id);
        callbacksRef.current.onSelectItem?.({ type: 'trace', data: trace });
      } else {
        const trace = inv.traces.find((t) => t.id === data.parent);
        const walletNode = trace?.nodes.find((n) => n.id === data.id);
        callbacksRef.current.onSelectItem?.({ type: 'wallet', data: walletNode });
      }
    });

    cy.on('tap', 'edge', (event: EventObject) => {
      const edge = event.target;
      const data = edge.data();
      const inv = investigationRef.current;
      if (!inv) return;

      for (const trace of inv.traces) {
        const tx = trace.edges.find((e) => e.id === data.id);
        if (tx) {
          callbacksRef.current.onSelectItem?.({ type: 'transaction', data: tx });
          break;
        }
      }
    });

    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) {
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

    return () => {
      cy.destroy();
      cyRef.current = null;
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

      if (trace.collapsed) {
        // Collapsed trace: single node with wallet count label
        targetNodes.set(trace.id, {
          data: {
            id: trace.id,
            label: `${trace.name} (${trace.nodes.length})`,
            color: trace.color || '#3b82f6',
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
            color: trace.color || '#3b82f6',
            collapsed: false,
          },
          position: trace.position || { x: 0, y: 0 },
        });

        // Wallet nodes
        trace.nodes.forEach((node) => {
          targetNodes.set(node.id, {
            data: {
              id: node.id,
              parent: trace.id,
              label: node.label,
              color: node.color || '#60a5fa',
            },
            position: node.position,
          });
        });

        // Transaction edges
        trace.edges.forEach((edge) => {
          targetEdges.set(edge.id, {
            data: {
              id: edge.id,
              source: edge.from,
              target: edge.to,
              label: edge.label || `${edge.amount} ${edge.token.symbol}`,
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
      setTimeout(() => {
        if (cy.elements().length > 0) {
          cy.fit(undefined, 50);
          hasInitialFit.current = true;
        }
      }, 100);
    }
  }, [investigation]);

  return { containerRef, cy: cyRef.current };
}
