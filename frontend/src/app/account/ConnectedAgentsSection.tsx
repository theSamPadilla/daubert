'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaTrash, FaCopy, FaCheck } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { useAuth } from '@/components/Auth/AuthProvider';

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
    <div className="flex items-center gap-3 px-4 py-3 mb-4 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="hover:text-white transition-colors text-xs">
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
      className="p-1.5 text-ink-faint hover:text-brand-ink transition-colors"
      title="Copy"
    >
      {copied ? <FaCheck size={12} /> : <FaCopy size={12} />}
    </button>
  );
}

interface ConnectPanelProps {
  response: StartConnectResponse;
}

type ConnectTab = 'claudeApps' | 'claudeCode';

const CONNECT_TABS: { key: ConnectTab; label: string }[] = [
  { key: 'claudeApps', label: 'Claude Desktop / claude.ai' },
  { key: 'claudeCode', label: 'Claude Code (terminal)' },
];

function ConnectPanel({ response }: ConnectPanelProps) {
  const [tab, setTab] = useState<ConnectTab>('claudeApps');
  const instructions = response.perSurfaceInstructions[tab];

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-line-strong/60 bg-surface/40 p-4">
      <div>
        <p className="text-xs text-ink-muted mb-1 uppercase tracking-wider font-semibold">MCP Server URL</p>
        <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2">
          <code className="flex-1 text-xs text-white font-mono break-all">{response.mcpUrl}</code>
          <CopyButton text={response.mcpUrl} />
        </div>
      </div>

      <div>
        <div role="tablist" className="flex gap-1 border-b border-line-strong/60">
          {CONNECT_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={
                'px-3 py-2 text-xs font-medium rounded-t-md border-b-2 -mb-px transition-colors ' +
                (tab === t.key
                  ? 'border-brand-ink text-white bg-surface/60'
                  : 'border-transparent text-ink-muted hover:text-white')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="pt-3 space-y-3">
          <ol className="list-decimal list-outside ml-5 space-y-1.5">
            {instructions.steps.map((step, i) => (
              <li key={i} className="text-sm text-ink leading-relaxed pl-1">
                {step}
              </li>
            ))}
          </ol>

          {instructions.command && (
            <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2">
              <code className="flex-1 text-xs text-white font-mono break-all">{instructions.command}</code>
              <CopyButton text={instructions.command} />
            </div>
          )}

          {instructions.note && (
            <p className="text-xs text-ink-muted rounded-lg border border-line-strong/50 bg-surface/60 px-3 py-2 leading-relaxed">
              {instructions.note}
            </p>
          )}
        </div>
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
    <div id="agents" className="relative mt-6 p-6 rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] overflow-hidden scroll-mt-20">
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <h3 className="text-base font-semibold text-white mb-5">Connected agents</h3>

      {error && <Banner message={error} onClose={() => setError(null)} />}

      {loading ? (
        <Loader inline />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-ink-muted">No agents connected.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line-strong mb-4">
          <table className="w-full">
            <thead>
              <tr className="bg-surface/60 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">Agent</th>
                <th className="px-4 py-2.5">Organization</th>
                <th className="px-4 py-2.5">Last used</th>
                <th className="px-4 py-2.5">Connected</th>
                <th className="w-12 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-line-strong/50">
                  <td className="px-4 py-3 text-sm text-white">{s.surfaceLabel}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{orgName(s.organizationId)}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {s.lastUsedAt ? formatDate(s.lastUsedAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{formatDate(s.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRevoke(s)}
                      className="p-1.5 text-ink-faint hover:text-red-400 transition-colors"
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
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand hover:bg-brand/90 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {connecting ? 'Generating…' : 'Connect an agent'}
        </button>
        {connectResponse && (
          <button
            onClick={() => setConnectResponse(null)}
            className="text-xs text-ink-muted hover:text-white transition-colors"
          >
            Hide instructions
          </button>
        )}
      </div>

      {connectResponse && <ConnectPanel response={connectResponse} />}
    </div>
  );
}
