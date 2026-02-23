import { Investigation } from '../types/investigation';
import { useCytoscape } from '../hooks/useCytoscape';

interface GraphCanvasProps {
  investigation: Investigation | null;
  onSelectItem?: (item: any) => void;
}

export function GraphCanvas({ investigation, onSelectItem }: GraphCanvasProps) {
  const { containerRef } = useCytoscape(investigation, onSelectItem);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
