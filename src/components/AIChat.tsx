export function AIChat() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 p-4 overflow-y-auto">
        <p className="text-gray-400 text-sm">AI Chat - Coming in Phase 4</p>
      </div>
      <div className="border-t border-gray-700 p-4">
        <input
          type="text"
          placeholder="Ask AI to search transactions..."
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500"
          disabled
        />
      </div>
    </div>
  );
}
