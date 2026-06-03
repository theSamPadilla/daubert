'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';

// ─── Types ───────────────────────────────────────────────────────────────────

type TokenUsageOverview = components['schemas']['TokenUsageOverview'];
type TokenUsageByOrgRow = components['schemas']['TokenUsageByOrgRow'];
type TokenUsageByUserRow = components['schemas']['TokenUsageByUserRow'];
type TokenUsageByCaseRow = components['schemas']['TokenUsageByCaseRow'];
type TokenUsageByConversationRow = components['schemas']['TokenUsageByConversationRow'];
type TokenUsageOrgModelMatrixRow = components['schemas']['TokenUsageOrgModelMatrixRow'];
type TokenUsageCacheEffectiveness = components['schemas']['TokenUsageCacheEffectiveness'];

type DaysWindow = 7 | 30 | 90;

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtCost = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
};

const fmtTokens = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(n);
};

const fmtPct = (n: number | null | undefined): string => {
  if (n == null) return '—';
  return `${(n * 100).toFixed(1)}%`;
};

// ─── Shared style constants ───────────────────────────────────────────────────

const panelClass =
  'relative overflow-hidden rounded-xl border border-line-strong/60 bg-surface-panel shadow-[0_2px_12px_rgba(0,0,0,0.35)]';

const panelShine =
  'pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent';

const sectionLabel =
  'mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint';

const thClass =
  'px-4 py-3 text-left text-xs text-ink-faint uppercase tracking-wider';

const tdClass = 'px-4 py-3 text-sm';

const errorBox =
  'rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300';

// ─── Section wrapper ──────────────────────────────────────────────────────────

function SectionPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <p className={sectionLabel}>{title}</p>
      <div className={panelClass}>
        <div className={panelShine} />
        {children}
      </div>
    </div>
  );
}

// ─── Loading / error inline states ───────────────────────────────────────────

function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-10 text-sm text-ink-muted">
      Loading…
    </div>
  );
}

function SectionError({ msg }: { msg: string }) {
  return <div className={`m-4 ${errorBox}`}>{msg}</div>;
}

// ─── Hero KPI card ────────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${panelClass} p-5`}>
      <div className={panelShine} />
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint mb-1">{label}</p>
      <p className="text-2xl font-bold tracking-tight text-white">{value}</p>
    </div>
  );
}

// ─── Cache effectiveness stacked bar ─────────────────────────────────────────

const CACHE_SEGMENTS = [
  { key: 'cacheReadTokens',       label: 'Cache Reads',      color: 'bg-emerald-500' },
  { key: 'cacheCreation5mTokens', label: '5m Cache Writes',  color: 'bg-sky-500' },
  { key: 'cacheCreation1hTokens', label: '1h Cache Writes',  color: 'bg-violet-500' },
  { key: 'uncachedInputTokens',   label: 'Uncached Input',   color: 'bg-amber-500' },
  { key: 'outputTokens',          label: 'Output',           color: 'bg-rose-500' },
] as const;

function CacheBar({ data }: { data: TokenUsageCacheEffectiveness }) {
  const bd = data.breakdown;
  const total =
    bd.cacheReadTokens +
    bd.cacheCreation5mTokens +
    bd.cacheCreation1hTokens +
    bd.uncachedInputTokens +
    bd.outputTokens;

  if (total === 0) {
    return (
      <div className="px-4 py-6 text-sm text-ink-muted">No token data for this window.</div>
    );
  }

  return (
    <div className="px-4 py-5">
      {/* Stacked bar */}
      <div className="flex h-7 w-full overflow-hidden rounded-lg">
        {CACHE_SEGMENTS.map(({ key, color }) => {
          const count = bd[key];
          const pct = (count / total) * 100;
          if (pct < 0.1) return null;
          return (
            <div
              key={key}
              className={`${color} h-full`}
              style={{ width: `${pct}%` }}
              title={`${CACHE_SEGMENTS.find((s) => s.key === key)?.label}: ${fmtTokens(count)} tokens (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {CACHE_SEGMENTS.map(({ key, label, color }) => {
          const count = bd[key];
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />
              <span>{label}</span>
              <span className="text-ink-faint">({fmtTokens(count)}, {pct.toFixed(1)}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Org × Model matrix ───────────────────────────────────────────────────────

function OrgModelMatrix({ rows }: { rows: TokenUsageOrgModelMatrixRow[] }) {
  if (rows.length === 0) {
    return <div className="px-4 py-6 text-sm text-ink-muted">No data.</div>;
  }

  // Collect unique orgs (preserve order from API, which sorts by cost desc)
  const orgMap = new Map<string, string>(); // orgId → orgName
  for (const r of rows) {
    if (!orgMap.has(r.orgId)) orgMap.set(r.orgId, r.orgName);
  }

  // Collect unique models
  const models = [...new Set(rows.map((r) => r.model))];

  // Build a lookup: (orgId, model) → cost
  const lookup = new Map<string, number | null | undefined>();
  for (const r of rows) {
    lookup.set(`${r.orgId}::${r.model}`, r.cost);
  }

  const orgEntries = [...orgMap.entries()];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max">
        <thead>
          <tr className="bg-surface/40">
            <th className={`${thClass} min-w-[140px]`}>Org</th>
            {models.map((m) => (
              <th key={m} className={`${thClass} text-right`}>
                {m.replace('claude-', '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orgEntries.map(([orgId, orgName]) => (
            <tr key={orgId} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
              <td className={`${tdClass} font-medium text-white`}>{orgName}</td>
              {models.map((m) => {
                const cost = lookup.get(`${orgId}::${m}`);
                return (
                  <td key={m} className={`${tdClass} text-right text-ink-muted`}>
                    {cost != null ? fmtCost(cost) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SuperadminTokenUsagePage() {
  const [days, setDays] = useState<DaysWindow>(30);

  // Overview
  const [overview, setOverview] = useState<TokenUsageOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Cache effectiveness
  const [cache, setCache] = useState<TokenUsageCacheEffectiveness | null>(null);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [cacheError, setCacheError] = useState<string | null>(null);

  // By org
  const [byOrg, setByOrg] = useState<TokenUsageByOrgRow[]>([]);
  const [byOrgLoading, setByOrgLoading] = useState(true);
  const [byOrgError, setByOrgError] = useState<string | null>(null);

  // By user
  const [byUser, setByUser] = useState<TokenUsageByUserRow[]>([]);
  const [byUserLoading, setByUserLoading] = useState(true);
  const [byUserError, setByUserError] = useState<string | null>(null);

  // By case
  const [byCase, setByCase] = useState<TokenUsageByCaseRow[]>([]);
  const [byCaseLoading, setByCaseLoading] = useState(true);
  const [byCaseError, setByCaseError] = useState<string | null>(null);

  // Org × model matrix
  const [matrix, setMatrix] = useState<TokenUsageOrgModelMatrixRow[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(true);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  // By conversation
  const [byConversation, setByConversation] = useState<TokenUsageByConversationRow[]>([]);
  const [byConversationLoading, setByConversationLoading] = useState(true);
  const [byConversationError, setByConversationError] = useState<string | null>(null);

  // ─── Fetch: overview ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setOverviewLoading(true);
    apiClient.superadminTokenUsageOverview(days)
      .then((r) => { if (!cancelled) { setOverview(r); setOverviewError(null); } })
      .catch((e: unknown) => { if (!cancelled) setOverviewError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setOverviewLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // ─── Fetch: cache effectiveness ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setCacheLoading(true);
    apiClient.superadminTokenUsageCacheEffectiveness(days)
      .then((r) => { if (!cancelled) { setCache(r); setCacheError(null); } })
      .catch((e: unknown) => { if (!cancelled) setCacheError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setCacheLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // ─── Fetch: by org ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setByOrgLoading(true);
    apiClient.superadminTokenUsageByOrg(days, 10)
      .then((r) => { if (!cancelled) { setByOrg(r); setByOrgError(null); } })
      .catch((e: unknown) => { if (!cancelled) setByOrgError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setByOrgLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // ─── Fetch: by user ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setByUserLoading(true);
    apiClient.superadminTokenUsageByUser(days, 10)
      .then((r) => { if (!cancelled) { setByUser(r); setByUserError(null); } })
      .catch((e: unknown) => { if (!cancelled) setByUserError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setByUserLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // ─── Fetch: by case ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setByCaseLoading(true);
    apiClient.superadminTokenUsageByCase(days, 10)
      .then((r) => { if (!cancelled) { setByCase(r); setByCaseError(null); } })
      .catch((e: unknown) => { if (!cancelled) setByCaseError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setByCaseLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // ─── Fetch: org × model matrix ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setMatrixLoading(true);
    apiClient.superadminTokenUsageOrgModelMatrix(days)
      .then((r) => { if (!cancelled) { setMatrix(r); setMatrixError(null); } })
      .catch((e: unknown) => { if (!cancelled) setMatrixError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setMatrixLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  // ─── Fetch: by conversation ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setByConversationLoading(true);
    apiClient.superadminTokenUsageByConversation(days, 20)
      .then((r) => { if (!cancelled) { setByConversation(r); setByConversationError(null); } })
      .catch((e: unknown) => { if (!cancelled) setByConversationError(String(e instanceof Error ? e.message : e)); })
      .finally(() => { if (!cancelled) setByConversationLoading(false); });
    return () => { cancelled = true; };
  }, [days]);

  return (
    <main className="relative max-w-6xl mx-auto px-6 py-12">

      {/* Page header */}
      <div className="mb-10 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-brand to-transparent" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              Superadmin
            </span>
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">Token Usage</h2>
          <p className="mt-2 text-sm text-ink-muted">
            API spend and cache analytics across all orgs.
          </p>
        </div>

        {/* Window selector */}
        <div className="shrink-0 mt-1">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value) as DaysWindow)}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:border-brand transition-colors"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Hero KPIs */}
      {overviewLoading ? (
        <div className="mb-8">
          <Loader inline />
        </div>
      ) : overviewError ? (
        <div className={`mb-8 ${errorBox}`}>{overviewError}</div>
      ) : overview ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Cost" value={fmtCost(overview.totalCost)} />
          <KpiCard label="Total Tokens" value={fmtTokens(overview.totalTokens)} />
          <KpiCard label="API Calls" value={fmtTokens(overview.totalCalls)} />
          <KpiCard label="Cache Hit Rate" value={fmtPct(overview.cacheHitRate)} />
        </div>
      ) : null}

      {/* Cache effectiveness */}
      <SectionPanel title="Cache Effectiveness">
        {cacheLoading ? (
          <SectionLoading />
        ) : cacheError ? (
          <SectionError msg={cacheError} />
        ) : cache ? (
          <CacheBar data={cache} />
        ) : null}
      </SectionPanel>

      {/* Top orgs */}
      <SectionPanel title="Top Organizations">
        {byOrgLoading ? (
          <SectionLoading />
        ) : byOrgError ? (
          <SectionError msg={byOrgError} />
        ) : byOrg.length === 0 ? (
          <div className="px-4 py-6 text-sm text-ink-muted">No data.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40">
                <th className={`${thClass} w-10`}>#</th>
                <th className={thClass}>Organization</th>
                <th className={`${thClass} text-right`}>Calls</th>
                <th className={`${thClass} text-right`}>Tokens</th>
                <th className={`${thClass} text-right`}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {byOrg.map((row, i) => (
                <tr key={row.orgId} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
                  <td className={`${tdClass} text-ink-faint`}>{i + 1}</td>
                  <td className={`${tdClass} font-medium text-white`}>{row.orgName}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtTokens(row.calls)}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtTokens(row.totalTokens)}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtCost(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionPanel>

      {/* Top users */}
      <SectionPanel title="Top Users">
        {byUserLoading ? (
          <SectionLoading />
        ) : byUserError ? (
          <SectionError msg={byUserError} />
        ) : byUser.length === 0 ? (
          <div className="px-4 py-6 text-sm text-ink-muted">No data.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40">
                <th className={`${thClass} w-10`}>#</th>
                <th className={thClass}>Email</th>
                <th className={thClass}>Org</th>
                <th className={`${thClass} text-right`}>Calls</th>
                <th className={`${thClass} text-right`}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {byUser.map((row, i) => (
                <tr key={row.userId} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
                  <td className={`${tdClass} text-ink-faint`}>{i + 1}</td>
                  <td className={`${tdClass} font-medium text-white`}>{row.email}</td>
                  <td className={`${tdClass} text-ink-muted`}>{row.orgName ?? '—'}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtTokens(row.calls)}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtCost(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionPanel>

      {/* Top cases */}
      <SectionPanel title="Top Cases">
        {byCaseLoading ? (
          <SectionLoading />
        ) : byCaseError ? (
          <SectionError msg={byCaseError} />
        ) : byCase.length === 0 ? (
          <div className="px-4 py-6 text-sm text-ink-muted">No data.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40">
                <th className={`${thClass} w-10`}>#</th>
                <th className={thClass}>Case</th>
                <th className={thClass}>Org</th>
                <th className={`${thClass} text-right`}>Calls</th>
                <th className={`${thClass} text-right`}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {byCase.map((row, i) => (
                <tr key={row.caseId} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
                  <td className={`${tdClass} text-ink-faint`}>{i + 1}</td>
                  <td className={`${tdClass} font-medium text-white`}>{row.caseName}</td>
                  <td className={`${tdClass} text-ink-muted`}>{row.orgName ?? '—'}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtTokens(row.calls)}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtCost(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionPanel>

      {/* Org × model matrix */}
      <SectionPanel title="Org × Model Cost Matrix">
        {matrixLoading ? (
          <SectionLoading />
        ) : matrixError ? (
          <SectionError msg={matrixError} />
        ) : (
          <OrgModelMatrix rows={matrix} />
        )}
      </SectionPanel>

      {/* Top conversations */}
      <SectionPanel title="Top Conversations">
        {byConversationLoading ? (
          <SectionLoading />
        ) : byConversationError ? (
          <SectionError msg={byConversationError} />
        ) : byConversation.length === 0 ? (
          <div className="px-4 py-6 text-sm text-ink-muted">No data.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40">
                <th className={`${thClass} w-10`}>#</th>
                <th className={thClass}>Title</th>
                <th className={thClass}>Case</th>
                <th className={thClass}>User</th>
                <th className={`${thClass} text-right`}>Calls</th>
                <th className={`${thClass} text-right`}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {byConversation.map((row, i) => (
                <tr key={row.conversationId} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
                  <td className={`${tdClass} text-ink-faint`}>{i + 1}</td>
                  <td className={`${tdClass} font-medium text-white`}>
                    {row.title ?? <span className="text-ink-faint italic">(untitled)</span>}
                  </td>
                  <td className={`${tdClass} text-ink-muted`}>{row.caseName ?? '—'}</td>
                  <td className={`${tdClass} text-ink-muted`}>{row.userEmail ?? '—'}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtTokens(row.calls)}</td>
                  <td className={`${tdClass} text-right text-ink-muted`}>{fmtCost(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionPanel>

    </main>
  );
}
