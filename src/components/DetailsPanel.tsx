interface DetailsPanelProps {
  selectedItem: any | null;
}

export function DetailsPanel({ selectedItem }: DetailsPanelProps) {
  if (!selectedItem) {
    return (
      <div className="p-4 text-gray-400 text-sm">
        Select a wallet, transaction, or trace to view details
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-300 uppercase">Details</h3>
      <div className="text-sm">
        <p className="text-gray-400">Selected: {selectedItem.type}</p>
        <pre className="mt-2 text-xs text-gray-300 overflow-auto">
          {JSON.stringify(selectedItem, null, 2)}
        </pre>
      </div>
    </div>
  );
}
