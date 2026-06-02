'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';

type CaseSummary = components['schemas']['CaseSummary'];

export default function SuperadminCasesPage() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await apiClient.superadminListCases();
      setCases(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Cases</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Aggregate case telemetry across all organizations. Read-only.
        </p>
      </div>

      {loadError && (
        <div className="mb-4 rounded bg-red-900/50 p-3 text-sm text-red-300">{loadError}</div>
      )}

      {loading ? (
        <Loader inline />
      ) : cases.length === 0 ? (
        <p className="py-12 text-center text-ink-muted">No cases yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-panel/50 text-left text-sm text-ink-muted">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-b border-line-strong/50">
                  <td className="px-4 py-3 text-sm font-medium text-white">{c.name}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{c.orgName}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{c.memberCount}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
