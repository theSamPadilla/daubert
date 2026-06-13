'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { Kicker, Panel } from '@/components/ui';

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
    <main className="relative max-w-5xl mx-auto px-6 py-12">
      <div className="mb-10">
        <Kicker className="mb-3 block">Superadmin</Kicker>
        <h2 className="mt-1 text-4xl font-bold tracking-tight text-ink">
          Cases
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Aggregate case telemetry across all organizations. Read-only.
        </p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">
          {loadError}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : cases.length === 0 ? (
        <Panel className="py-16 text-center">
          <p className="text-sm text-ink-muted">No cases yet.</p>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Name</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Organization</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Members</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-b border-line hover:bg-surface-panel transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-ink">{c.name}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">{c.orgName}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">{c.memberCount}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </main>
  );
}
