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
    <main className="relative max-w-5xl mx-auto px-6 py-12">
      <div className="mb-10">
        <div className="flex items-center gap-3">
          <span className="h-px w-8 bg-gradient-to-r from-brand to-transparent" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            Superadmin
          </span>
        </div>
        <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">
          Cases
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Aggregate case telemetry across all organizations. Read-only.
        </p>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : cases.length === 0 ? (
        <div className="rounded-xl border border-line-strong/60 bg-surface-panel/50 py-16 text-center">
          <p className="text-sm text-ink-muted">No cases yet.</p>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-line-strong/60 bg-surface-panel shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
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
    </main>
  );
}
