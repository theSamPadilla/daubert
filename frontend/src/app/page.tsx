'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { apiClient, type Case, type Investigation } from '@/lib/api-client';

export default function DashboardPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCase, setSelectedCase] = useState<(Case & { investigations?: Investigation[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [newCaseName, setNewCaseName] = useState('');
  const [newInvName, setNewInvName] = useState('');

  const loadCases = useCallback(async () => {
    try {
      const data = await apiClient.listCases();
      setCases(data);
    } catch (err) {
      console.error('Failed to load cases:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCases(); }, [loadCases]);

  const handleSelectCase = async (c: Case) => {
    try {
      const full = await apiClient.getCase(c.id);
      setSelectedCase(full);
    } catch (err) {
      console.error('Failed to load case:', err);
    }
  };

  const handleCreateCase = async () => {
    if (!newCaseName.trim()) return;
    try {
      await apiClient.createCase({ name: newCaseName.trim() });
      setNewCaseName('');
      loadCases();
    } catch (err) {
      console.error('Failed to create case:', err);
    }
  };

  const handleCreateInvestigation = async () => {
    if (!selectedCase || !newInvName.trim()) return;
    try {
      await apiClient.createInvestigation(selectedCase.id, { name: newInvName.trim() });
      setNewInvName('');
      handleSelectCase(selectedCase);
    } catch (err) {
      console.error('Failed to create investigation:', err);
    }
  };

  const handleDeleteCase = async (id: string) => {
    if (!confirm('Delete this case and all its investigations?')) return;
    try {
      await apiClient.deleteCase(id);
      if (selectedCase?.id === id) setSelectedCase(null);
      loadCases();
    } catch (err) {
      console.error('Failed to delete case:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Daubert</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Cases list */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Cases</h2>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newCaseName}
              onChange={(e) => setNewCaseName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCase()}
              placeholder="New case name..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            />
            <button
              onClick={handleCreateCase}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
            >
              Create
            </button>
          </div>
          <div className="space-y-2">
            {cases.map((c) => (
              <div
                key={c.id}
                onClick={() => handleSelectCase(c)}
                className={`p-3 rounded cursor-pointer border transition-colors ${
                  selectedCase?.id === c.id
                    ? 'bg-gray-700 border-blue-500'
                    : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteCase(c.id); }}
                    className="text-xs text-gray-500 hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(c.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
            {cases.length === 0 && (
              <p className="text-gray-500 text-sm">No cases yet. Create one to get started.</p>
            )}
          </div>
        </div>

        {/* Selected case details */}
        <div>
          {selectedCase ? (
            <>
              <h2 className="text-xl font-semibold mb-4">{selectedCase.name}</h2>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newInvName}
                  onChange={(e) => setNewInvName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateInvestigation()}
                  placeholder="New investigation name..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                />
                <button
                  onClick={handleCreateInvestigation}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
                >
                  Create
                </button>
              </div>
              <div className="space-y-2">
                {selectedCase.investigations?.map((inv) => (
                  <Link
                    key={inv.id}
                    href={`/investigation/${inv.id}`}
                    className="block p-3 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded transition-colors"
                  >
                    <span className="font-medium">{inv.name}</span>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                ))}
                {(!selectedCase.investigations || selectedCase.investigations.length === 0) && (
                  <p className="text-gray-500 text-sm">No investigations yet.</p>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Select a case to view investigations
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
