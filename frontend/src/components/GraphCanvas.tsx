import { forwardRef, useImperativeHandle } from 'react';
import { Investigation } from '../types/investigation';
import { useCytoscape, CytoscapeCallbacks } from '../hooks/useCytoscape';

export interface GraphCanvasHandle {
  unselectAll: () => void;
  exportImage: (format: 'png' | 'pdf', filename?: string) => void;
  setEdgeArc: (edgeId: string, delta: number | null) => void;
}

interface GraphCanvasProps {
  investigation: Investigation | null;
  callbacks: CytoscapeCallbacks;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  ({ investigation, callbacks }, ref) => {
    const { containerRef, unselectAll, exportImage, setEdgeArc } = useCytoscape(investigation, callbacks);

    useImperativeHandle(ref, () => ({ unselectAll, exportImage, setEdgeArc }), [unselectAll, exportImage, setEdgeArc]);

    return (
      <div className="relative w-full h-full">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    );
  }
);

GraphCanvas.displayName = 'GraphCanvas';
