'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaTrash,
  FaCopy,
  FaCheck,
  FaCircleInfo,
  FaTriangleExclamation,
  FaChevronDown,
} from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { useAuth } from '@/components/Auth/AuthProvider';
import { SURFACE_ICONS, iconForAgentLabel } from '@/components/Agents/agentBrand';
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

/**
 * Copy-to-clipboard control. Icon-only by default; pass `label` for the
 * labelled variant used by the share-link row, which needs to say what it
 * copies rather than relying on a tooltip.
 */
function CopyButton({ text, label }: { text: string; label?: string }) {
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

  const Icon = copied ? FaCheck : FaCopy;

  if (label) {
    return (
      <button
        onClick={handleCopy}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Icon size={11} aria-hidden />
        {copied ? 'Copied' : label}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 text-ink-faint hover:text-brand transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
      title="Copy"
    >
      <Icon size={12} />
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
  /** Surface to open on, resolved from an ?agent=… deep link. */
  initialTab?: ConnectTab;
}

type ConnectTab = 'claudeApps' | 'chatgpt' | 'perplexity';

interface TabDef {
  key: ConnectTab;
  label: string;
}

/** Surfaces we have verified end-to-end — each gets its own tab. */
const PRIMARY_TABS: TabDef[] = [
  { key: 'claudeApps', label: 'Claude' },
  { key: 'chatgpt', label: 'ChatGPT' },
];

/**
 * Surfaces behind the "Other agents" dropdown: supported on paper, but not
 * verified by us. Keeping them off the main tab row stops an unverified path
 * from reading as being on equal footing with Claude and ChatGPT.
 */
const OTHER_TABS: TabDef[] = [{ key: 'perplexity', label: 'Perplexity' }];

const ALL_TABS: TabDef[] = [...PRIMARY_TABS, ...OTHER_TABS];

/** Every surface asks for the same connector name. */
const CONNECTOR_NAME = 'Daubert';

/**
 * Resolves an `?agent=` value to a surface. Returns null for anything
 * unrecognised so a stale or hand-edited link falls back to the default tab
 * instead of rendering an empty panel.
 */
function tabFromParam(value: string | null): ConnectTab | null {
  return ALL_TABS.find((t) => t.key === value)?.key ?? null;
}

/**
 * Shareable link that opens the account page with the instructions already
 * expanded on `tab` and the agents section scrolled into view. This is what
 * gets handed to someone who needs to connect a specific assistant.
 */
function instructionsLink(tab: ConnectTab): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/account?connect=1&agent=${tab}#agents`;
}

/** Shared tab styling — the dropdown trigger has to match the real tabs. */
function tabClasses(active: boolean): string {
  return (
    'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ' +
    (active
      ? 'border-brand text-ink bg-surface-panel'
      : 'border-transparent text-ink-muted hover:text-ink hover:bg-surface-raised')
  );
}

/**
 * The "Other agents" tab. Collapses to the selected agent's name once one is
 * picked, so the active tab always says which instructions are on screen.
 */
function OtherAgentsTab({
  tab,
  onSelect,
}: {
  tab: ConnectTab;
  onSelect: (key: ConnectTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = OTHER_TABS.find((t) => t.key === tab);
  const Icon = selected ? SURFACE_ICONS[selected.key] : null;

  return (
    <div className="relative flex-1 flex" ref={ref}>
      <button
        role="tab"
        aria-selected={selected !== undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={tabClasses(selected !== undefined)}
      >
        {Icon && <Icon size={14} aria-hidden />}
        {selected ? selected.label : 'Other agents'}
        <FaChevronDown size={10} aria-hidden className="text-ink-faint" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-line bg-surface py-1 shadow-[0_24px_60px_-30px_rgba(11,18,32,0.18)]"
        >
          {OTHER_TABS.map((t) => {
            const ItemIcon = SURFACE_ICONS[t.key];
            return (
              <button
                key={t.key}
                role="menuitem"
                onClick={() => {
                  onSelect(t.key);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-soft transition-colors hover:bg-surface-raised"
              >
                <ItemIcon size={14} aria-hidden className="text-ink-faint" />
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectPanel({ response, initialTab }: ConnectPanelProps) {
  const [tab, setTab] = useState<ConnectTab>(initialTab ?? 'claudeApps');
  const instructions = response.perSurfaceInstructions[tab];
  const activeLabel = ALL_TABS.find((t) => t.key === tab)?.label ?? '';

  return (
    <div className="mt-5 rounded-xl border border-line bg-surface-panel overflow-hidden">
      {/* The two values every surface asks for — pinned at top */}
      <div className="grid gap-3 px-5 py-4 border-b border-line bg-surface sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <CopyableField label="Name" value={CONNECTOR_NAME} />
        <CopyableField label="MCP Server URL" value={response.mcpUrl} />
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex border-b border-line bg-surface">
        {PRIMARY_TABS.map((t) => {
          const Icon = SURFACE_ICONS[t.key];
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={tabClasses(tab === t.key)}
            >
              <Icon size={14} aria-hidden />
              {t.label}
            </button>
          );
        })}
        <OtherAgentsTab tab={tab} onSelect={setTab} />
      </div>

      {/* Tab content. tabIndex -1 so an ?agent=… deep link can move focus
          here on arrival, which lands screen readers on the steps rather than
          at the top of the account page. */}
      <div
        role="tabpanel"
        id="agent-instructions"
        tabIndex={-1}
        className="px-5 py-5 space-y-4 focus:outline-none"
      >
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

        {/* Share row — hands someone a link that lands on exactly these steps. */}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-ink-faint leading-relaxed">
            Opens the account page with the {activeLabel} steps already showing.
          </p>
          <CopyButton text={instructionsLink(tab)} label="Copy link" />
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
  const [deepLinkTab, setDeepLinkTab] = useState<ConnectTab | null>(null);

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

  // Deep link: /account?connect=1#agents auto-opens the connect instructions
  // (the cases-page agent button), and an added &agent=<surface> opens them on
  // that surface's tab (the "Copy link" button below). Read via
  // window.location (client-only) to avoid the useSearchParams Suspense
  // requirement.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = tabFromParam(params.get('agent'));
    if (requested) setDeepLinkTab(requested);
    if (params.get('connect') === '1' || requested) {
      handleConnect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once a deep-linked panel has rendered, pull it into view and move focus to
  // it. The #agents hash alone is not enough: the section mounts after the
  // sessions request resolves, so the browser has usually given up on the
  // fragment by the time the element exists.
  useEffect(() => {
    if (!connectResponse || !deepLinkTab) return;
    const el = document.getElementById('agent-instructions');
    if (!el) return;
    el.focus({ preventScroll: true });
    // Guarded: scrollIntoView is missing in jsdom and some embedded webviews,
    // and a throw here would unmount the instructions the link exists to show.
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [connectResponse, deepLinkTab]);

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
              {sessions.map((s) => {
                const AgentIcon = iconForAgentLabel(s.surfaceLabel);
                return (
                <tr key={s.id} className="border-b border-line hover:bg-surface-panel transition-colors">
                  <td className="px-4 py-3 text-sm text-ink">
                    <span className="flex items-center gap-2">
                      <AgentIcon size={14} aria-hidden className="flex-shrink-0 text-ink-muted" />
                      {s.surfaceLabel}
                    </span>
                  </td>
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
                );
              })}
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
          {connecting ? 'Generating…' : 'Connect your AI'}
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

      {connectResponse && (
        // key: if the deep-linked tab resolves after the panel first mounts,
        // remount so the initial tab is honoured rather than ignored.
        <ConnectPanel
          key={deepLinkTab ?? 'default'}
          response={connectResponse}
          initialTab={deepLinkTab ?? undefined}
        />
      )}
    </Panel>
  );
}
