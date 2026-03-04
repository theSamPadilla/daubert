import { Investigation } from '../types/investigation';
import { useCytoscape, CytoscapeCallbacks } from '../hooks/useCytoscape';

interface GraphCanvasProps {
  investigation: Investigation | null;
  callbacks: CytoscapeCallbacks;
}

export function GraphCanvas({ investigation, callbacks }: GraphCanvasProps) {
  const { containerRef } = useCytoscape(investigation, callbacks);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
