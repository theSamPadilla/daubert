import { useEffect, useRef } from 'react';
import cytoscape, { Core } from 'cytoscape';
import { Investigation } from '../types/investigation';

export function useCytoscape(investigation: Investigation | null) {
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

    return () => {
      cy.destroy();
    };
  }, [investigation]);

  return { containerRef, cy: cyRef.current };
}
