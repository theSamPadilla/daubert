'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaTrash, FaCopy, FaCheck, FaCircleInfo, FaTriangleExclamation } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { useAuth } from '@/components/Auth/AuthProvider';
import { Button, Panel, Kicker } from '@/components/ui';

type OAuthSession = components['schemas']['OAuthSessionSummary'];
type StartConnectResponse = components['schemas']['StartConnectResponse'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Banner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 mb-4 rounded-lg border border-redline/30 bg-redline/8 text-redline text-sm">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="hover:text-ink transition-colors text-xs">
        Dismiss
      </button>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — silent fail
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-ink-faint hover:text-brand transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
      title="Copy"
    >
      {copied ? <FaCheck size={12} /> : <FaCopy size={12} />}
    </button>
  );
}

function CopyableField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Kicker className="mb-1.5">{label}</Kicker>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2">
        <code className="flex-1 text-sm text-brand font-mono break-all">{value}</code>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

interface ConnectPanelProps {
  response: StartConnectResponse;
}

type ConnectTab = 'claudeApps' | 'chatgpt';

const CONNECT_TABS: { key: ConnectTab; label: string }[] = [
  { key: 'claudeApps', label: 'Claude' },
  { key: 'chatgpt', label: 'ChatGPT' },
];

/** Both surfaces ask for the same connector name. */
const CONNECTOR_NAME = 'Daubert';

function ConnectPanel({ response }: ConnectPanelProps) {
  const [tab, setTab] = useState<ConnectTab>('claudeApps');
  const instructions = response.perSurfaceInstructions[tab];

  return (
    <div className="mt-5 rounded-xl border border-line bg-surface-panel overflow-hidden">
      {/* The two values every surface asks for — pinned at top */}
      <div className="grid gap-3 px-5 py-4 border-b border-line bg-surface sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <CopyableField label="Name" value={CONNECTOR_NAME} />
        <CopyableField label="MCP Server URL" value={response.mcpUrl} />
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex border-b border-line bg-surface">
        {CONNECT_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={
              'flex-1 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ' +
              (tab === t.key
                ? 'border-brand text-ink bg-surface-panel'
                : 'border-transparent text-ink-muted hover:text-ink hover:bg-surface-raised')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div role="tabpanel" className="px-5 py-5 space-y-4">
        {/* Numbered steps with colored badges */}
        <ol className="space-y-3">
          {instructions.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-soft border border-brand/30 text-brand text-xs font-semibold flex items-center justify-center mt-0.5"
              >
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-ink leading-relaxed pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        {instructions.warning && (
          <div className="flex items-start gap-2.5 rounded-lg border border-redline/30 bg-redline/8 px-3 py-2.5">
            <FaTriangleExclamation size={14} className="text-redline flex-shrink-0 mt-0.5" />
            <p className="text-xs text-ink leading-relaxed">{instructions.warning}</p>
          </div>
        )}

        {instructions.note && (
          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-panel px-3 py-2.5">
            <FaCircleInfo size={14} className="text-ink-muted flex-shrink-0 mt-0.5" />
            <p className="text-xs text-ink-muted leading-relaxed">{instructions.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ConnectedAgentsSection() {
  const confirm = useConfirm();
  const { user } = useAuth();

  const [sessions, setSessions] = useState<OAuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectResponse, setConnectResponse] = useState<StartConnectResponse | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listOauthSessions();
      setSessions(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load agent sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Deep link from the cases-page agent button: /account?connect=1#agents
  // auto-opens the connect instructions. Read via window.location (client-only)
  // to avoid the useSearchParams Suspense requirement.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('connect') === '1') {
      handleConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRevoke = async (session: OAuthSession) => {
    const ok = await confirm({
      title: "Revoke this agent's access?",
      message: `The agent "${session.surfaceLabel}" will no longer be able to access Daubert.`,
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.revokeOauthSession(session.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to revoke session');
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setConnectResponse(null);
    try {
      const res = await apiClient.startConnect();
      setConnectResponse(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start connect flow');
    } finally {
      setConnecting(false);
    }
  };

  // Resolve org name from the user's orgs list (already loaded via useAuth).
  const orgName = (organizationId: string): string => {
    const org = user?.orgs.find((o) => o.id === organizationId);
    return org?.name ?? organizationId;
  };

  return (
    <Panel id="agents" className="mt-6 scroll-mt-20 overflow-hidden" padded>
      <h3 className="text-base font-semibold text-ink mb-5">Connected agents</h3>

      {error && <Banner message={error} onClose={() => setError(null)} />}

      {loading ? (
        <Loader inline />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-ink-muted">No agents connected.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line mb-4 -mx-5">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-panel text-left">
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Agent</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Organization</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Last used</th>
                <th className="px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">Connected</th>
                <th className="w-12 px-4 py-2.5 border-b border-line"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-line hover:bg-surface-panel transition-colors">
                  <td className="px-4 py-3 text-sm text-ink">{s.surfaceLabel}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{orgName(s.organizationId)}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {s.lastUsedAt ? formatDate(s.lastUsedAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{formatDate(s.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRevoke(s)}
                      className="p-1.5 text-ink-faint hover:text-redline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
                      title="Revoke agent access"
                    >
                      <FaTrash size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={handleConnect}
          disabled={connecting}
          size="sm"
        >
          {connecting ? 'Generating…' : 'Connect an agent'}
        </Button>
        {connectResponse && (
          <button
            onClick={() => setConnectResponse(null)}
            className="text-xs text-ink-muted hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
          >
            Hide instructions
          </button>
        )}
      </div>

      {connectResponse && <ConnectPanel response={connectResponse} />}
    </Panel>
  );
}
