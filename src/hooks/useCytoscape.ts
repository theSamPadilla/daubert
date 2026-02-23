import { useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { Investigation } from '../types/investigation';

export function useCytoscape(
  investigation: Investigation | null,
  onSelectItem?: (item: any) => void
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current || !investigation) return;

    // Initialize Cytoscape
    const cy = cytoscape({
      container: containerRef.current,
      style: [
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
      ],
      layout: { name: 'preset' },
    });

    cyRef.current = cy;

    // Convert investigation data to Cytoscape elements
    const elements: any[] = [];

    investigation.traces.forEach((trace) => {
      if (!trace.visible) return;

      // Add parent node for trace
      elements.push({
        data: {
          id: trace.id,
          label: trace.name,
          color: trace.color || '#3b82f6',
        },
        position: trace.position || { x: 0, y: 0 },
      });

      // Add wallet nodes
      trace.nodes.forEach((node) => {
        elements.push({
          data: {
            id: node.id,
            parent: trace.id,
            label: node.label,
            color: node.color || '#60a5fa',
          },
          position: node.position,
        });
      });

      // Add transaction edges
      trace.edges.forEach((edge) => {
        elements.push({
          data: {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            label: edge.label || `${edge.amount} ${edge.token.symbol}`,
            color: edge.color || '#10b981',
          },
        });
      });
    });

    cy.add(elements);
    cy.fit();

    // Add click handlers
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      const data = node.data();

      // Check if it's a wallet node or trace parent
      const isParent = node.isParent();

      if (isParent) {
        // Trace selected
        const trace = investigation.traces.find((t) => t.id === data.id);
        onSelectItem?.({ type: 'trace', data: trace });
      } else {
        // Wallet node selected
        const trace = investigation.traces.find((t) => t.id === data.parent);
        const walletNode = trace?.nodes.find((n) => n.id === data.id);
        onSelectItem?.({ type: 'wallet', data: walletNode });
      }
    });

    cy.on('tap', 'edge', (event) => {
      const edge = event.target;
      const data = edge.data();

      // Find the transaction
      let transaction = null;
      for (const trace of investigation.traces) {
        const tx = trace.edges.find((e) => e.id === data.id);
        if (tx) {
          transaction = tx;
          break;
        }
      }

      onSelectItem?.({ type: 'transaction', data: transaction });
    });

    // Click on background to deselect
    cy.on('tap', (event) => {
      if (event.target === cy) {
        onSelectItem?.(null);
      }
    });

    return () => {
      cy.destroy();
    };
  }, [investigation, onSelectItem]);

  return { containerRef, cy: cyRef.current };
}
