import { Investigation } from '../types/investigation';
import { useCytoscape } from '../hooks/useCytoscape';

interface GraphCanvasProps {
  investigation: Investigation | null;
}

export function GraphCanvas({ investigation }: GraphCanvasProps) {
  const { containerRef } = useCytoscape(investigation);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
      />
    </div>
  );
}
