import { DetailsPanel } from './DetailsPanel';
import { AIChat } from './AIChat';

interface SidePanelProps {
  selectedItem: any | null;
}

export function SidePanel({ selectedItem }: SidePanelProps) {
  return (
    <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
      <div className="flex-1 border-b border-gray-700 overflow-y-auto">
        <DetailsPanel selectedItem={selectedItem} />
      </div>
      <div className="h-80 overflow-hidden">
        <AIChat />
      </div>
    </div>
  );
}
