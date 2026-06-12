'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useAuth } from '@/components/Auth/AuthProvider';

type AgentAction = components['schemas']['AgentActionSummary'];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function humanizeAction(action: string): string {
  return action.replace(/_/g, ' ');
}

function formatTarget(targetRef: string | null): string {
  if (!targetRef) return '—';
  const [type, id] = targetRef.split(':');
  return id ? `${type} ${id.slice(0, 8)}` : targetRef;
}

export function AgentActivitySection() {
  const { user } = useAuth();
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .listAgentActions()
      .then(setActions)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load agent activity'),
      )
      .finally(() => setLoading(false));
  }, []);

  const orgName = (organizationId: string): string => {
    const org = user?.orgs.find((o) => o.id === organizationId);
    return org?.name ?? organizationId;
  };

  return (
    <div className="relative mt-6 p-6 rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] overflow-hidden">
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <h3 className="text-base font-semibold text-white mb-1">Agent activity</h3>
      <p className="text-xs text-ink-muted mb-5">
        Every change a connected agent makes (or is denied) is recorded here, including from
        disconnected agents.
      </p>

      {error && (
        <p className="text-sm text-red-300 mb-4">{error}</p>
      )}

      {loading ? (
        <Loader inline />
      ) : actions.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No agent activity yet. Actions your agents take — creating investigations, importing
          transactions, editing productions — will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface/60 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Agent</th>
                <th className="px-4 py-2.5">Organization</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Target</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id} className="border-t border-line-strong/50">
                  <td className="px-4 py-3 text-sm text-ink-muted whitespace-nowrap">
                    {formatDateTime(a.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{a.agentLabel}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{orgName(a.organizationId)}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted capitalize">
                    {humanizeAction(a.action)}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted font-mono text-xs" title={a.targetRef ?? undefined}>
                    {formatTarget(a.targetRef)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold ' +
                        (a.status === 'ok'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : 'bg-red-500/15 text-red-300 border border-red-500/30')
                      }
                    >
                      {a.status === 'ok' ? 'ok' : 'denied'}
                    </span>
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
