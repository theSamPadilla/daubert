import { mockInvestigation } from './data/mockInvestigation';

function App() {
  console.log('Mock investigation:', mockInvestigation);

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-xl font-semibold">Onchain Transaction Tracker</h1>
      </header>
      <div className="flex-1 flex">
        <div className="flex-1 bg-gray-900">
          <p className="p-4">Canvas area</p>
        </div>
        <div className="w-96 bg-gray-800 border-l border-gray-700">
          <p className="p-4">Side panel</p>
        </div>
      </div>
    </div>
  );
}

export default App;
