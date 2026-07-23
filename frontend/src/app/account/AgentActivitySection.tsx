'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useAuth } from '@/components/Auth/AuthProvider';
import { Badge, Panel } from '@/components/ui';

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
    <Panel className="mt-6 overflow-hidden" padded>
      <h3 className="text-base font-semibold text-ink mb-1">Agent activity</h3>
      <p className="text-xs text-ink-muted mb-5">
        Every change a connected agent makes (or is denied) is recorded here, including from
        disconnected agents.
      </p>

      {error && (
        <p className="text-sm text-redline mb-4">{error}</p>
      )}

      {loading ? (
        <Loader inline />
      ) : actions.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No agent activity yet. Actions your agents take (creating investigations, importing
          transactions, editing productions) will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line -mx-5">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-panel text-left">
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">When</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Agent</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Organization</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Action</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Target</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Status</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id} className="border-b border-line hover:bg-surface-panel transition-colors">
                  <td className="px-4 py-3 text-sm text-ink-muted whitespace-nowrap">
                    {formatDateTime(a.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink">{a.agentLabel}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{orgName(a.organizationId)}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted capitalize">
                    {humanizeAction(a.action)}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted font-mono text-xs" title={a.targetRef ?? undefined}>
                    {formatTarget(a.targetRef)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={a.status === 'ok' ? 'accent' : 'danger'}>
                      {a.status === 'ok' ? 'ok' : 'denied'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
