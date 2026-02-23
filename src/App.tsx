import { useState } from 'react';
import { mockInvestigation } from './data/mockInvestigation';
import { GraphCanvas } from './components/GraphCanvas';
import { SidePanel } from './components/SidePanel';
import { Header } from './components/Header';
import { Investigation } from './types/investigation';
import { saveInvestigation, loadInvestigation, createNewInvestigation } from './utils/fileOperations';

function App() {
  const [investigation, setInvestigation] = useState<Investigation | null>(mockInvestigation);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const handleNew = () => {
    if (confirm('Create new investigation? Unsaved changes will be lost.')) {
      setInvestigation(createNewInvestigation());
      setSelectedItem(null);
    }
  };

  const handleOpen = async () => {
    try {
      const loaded = await loadInvestigation();
      setInvestigation(loaded);
      setSelectedItem(null);
    } catch (error) {
      console.error('Failed to load investigation:', error);
      alert('Failed to load investigation file');
    }
  };

  const handleSave = () => {
    if (investigation) {
      saveInvestigation(investigation);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <Header
        investigation={investigation}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
      />
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
