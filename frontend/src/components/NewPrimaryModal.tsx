'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useCaseContext } from '@/contexts/CaseContext';

type PrimaryType = 'investigation' | 'production';
type ProductionType = 'report' | 'chart' | 'chronology';

export function NewPrimaryModal() {
  const router = useRouter();
  const { caseId, newPrimaryDefault, closeNewPrimary, setProductions, sidebar } = useCaseContext();

  const [tab, setTab] = useState<PrimaryType>(newPrimaryDefault);
  const [name, setName] = useState('');
  const [productionType, setProductionType] = useState<ProductionType>('report');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);

    try {
      if (tab === 'investigation') {
        const inv = await apiClient.createInvestigation(caseId, { name: trimmed });
        closeNewPrimary();
        router.push(`/cases/${caseId}/investigations?inv=${inv.id}`);
      } else {
        const defaultData =
          productionType === 'report' ? { content: '' }
          : productionType === 'chronology' ? { title: trimmed, entries: [] }
          : { chartType: 'bar', labels: [], datasets: [] };
        const prod = await apiClient.createProduction(caseId, {
          name: trimmed,
          type: productionType,
          data: defaultData,
        });
        setProductions((prev) => [...prev, prod]);
        sidebar.onSelectProduction?.(prod);
        closeNewPrimary();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeNewPrimary(); }}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-sm">
        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setTab('investigation')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === 'investigation'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Investigation
          </button>
          <button
            onClick={() => setTab('production')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === 'production'
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Production
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleSubmit(); }}
              placeholder={tab === 'investigation' ? 'e.g. Funds tracing' : 'e.g. Flow of Funds Report'}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>

          {/* Production type selector */}
          {tab === 'production' && (
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5">
                Type
              </label>
              <div className="flex gap-2">
                {(['report', 'chart', 'chronology'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setProductionType(t)}
                    className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      productionType === t
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={closeNewPrimary}
              disabled={submitting}
              className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || submitting}
              className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
