import { forwardRef, useImperativeHandle } from 'react';
import { Investigation } from '../../types/investigation';
import { useCytoscape, CytoscapeCallbacks } from '../../hooks/useCytoscape';
import type { ExportTheme } from '@/lib/exportTheme';

export interface GraphCanvasHandle {
  unselectAll: () => void;
  exportImage: (format: 'png' | 'pdf', filename?: string, theme?: ExportTheme, orientation?: 'portrait' | 'landscape') => Promise<void>;
  exportPngDataUrl: (theme?: ExportTheme) => Promise<string>;
  setEdgeArc: (edgeId: string, delta: number | null) => void;
}

interface GraphCanvasProps {
  investigation: Investigation | null;
  selectedNodeIds: { id: string; traceId: string }[];
  selectedEdgeIds: string[];
  callbacks: CytoscapeCallbacks;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  ({ investigation, selectedNodeIds, selectedEdgeIds, callbacks }, ref) => {
    const { containerRef, unselectAll, exportImage, exportPngDataUrl, setEdgeArc } = useCytoscape(
      investigation,
      selectedNodeIds,
      selectedEdgeIds,
      callbacks
    );

    useImperativeHandle(ref, () => ({ unselectAll, exportImage, exportPngDataUrl, setEdgeArc }), [unselectAll, exportImage, exportPngDataUrl, setEdgeArc]);

    return (
      <div className="relative w-full h-full">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    );
  }
);

GraphCanvas.displayName = 'GraphCanvas';
