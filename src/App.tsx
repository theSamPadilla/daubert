import { useState } from 'react';
import { mockInvestigation } from './data/mockInvestigation';
import { GraphCanvas } from './components/GraphCanvas';
import { SidePanel } from './components/SidePanel';
import { Investigation } from './types/investigation';

function App() {
  const [investigation, setInvestigation] = useState<Investigation | null>(mockInvestigation);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-xl font-semibold">
          {investigation?.name || 'Onchain Transaction Tracker'}
        </h1>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 bg-gray-900">
          <GraphCanvas
            investigation={investigation}
            onSelectItem={setSelectedItem}
          />
        </div>
        <SidePanel selectedItem={selectedItem} />
      </div>
    </div>
  );
}

export default App;
