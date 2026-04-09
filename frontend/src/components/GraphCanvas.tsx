import { forwardRef, useImperativeHandle } from 'react';
import { Investigation } from '../types/investigation';
import { useCytoscape, CytoscapeCallbacks } from '../hooks/useCytoscape';

export interface GraphCanvasHandle {
  unselectAll: () => void;
}

interface GraphCanvasProps {
  investigation: Investigation | null;
  callbacks: CytoscapeCallbacks;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  ({ investigation, callbacks }, ref) => {
    const { containerRef, unselectAll } = useCytoscape(investigation, callbacks);

    useImperativeHandle(ref, () => ({ unselectAll }), [unselectAll]);

    return (
      <div className="relative w-full h-full">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    );
  }
);

GraphCanvas.displayName = 'GraphCanvas';
