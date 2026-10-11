'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { Button, Input, Kicker, Panel, Select } from '@/components/ui';
import { actionLabel, keyInput, sourceLabel } from '@/components/Workspace/activityFormat';

type ToolCallRow = components['schemas']['ToolCallRow'];
type SummaryRow = components['schemas']['ToolCallSummaryRow'];

interface Filters {
  orgId: string;
  caseId: string;
  conversationId: string;
  userId: string;
  action: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { orgId: '', caseId: '', conversationId: '', userId: '', action: '', status: '', from: '', to: '' };
const PAGE_SIZE = 100;

const thClass = 'px-4 py-3 text-left font-mono text-[11px] uppercase tracking-wider text-ink-faint';
const tdClass = 'px-4 py-3 text-sm align-top';

/** datetime-local value to ISO, or undefined when blank. */
const toIso = (v: string): string | undefined => (v ? new Date(v).toISOString() : undefined);

function toParams(f: Filters): Record<string, string | undefined> {
  return {
    orgId: f.orgId.trim() || undefined,
    caseId: f.caseId.trim() || undefined,
    conversationId: f.conversationId.trim() || undefined,
    userId: f.userId.trim() || undefined,
    action: f.action.trim() || undefined,
    status: f.status || undefined,
    from: toIso(f.from),
    to: toIso(f.to),
  };
}

const errMsg = (e: unknown) => String(e instanceof Error ? e.message : e);

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function ToolCallsView() {
  const searchParams = useSearchParams();
  const initial = useMemo<Filters>(() => {
    const f = { ...EMPTY };
    for (const k of Object.keys(EMPTY) as (keyof Filters)[]) f[k] = searchParams.get(k) ?? '';
    return f;
    // Initial values only: the form owns state after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [draft, setDraft] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);

  const [rows, setRows] = useState<ToolCallRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const params = toParams(applied);
    setLoading(true);
    setExpanded(new Set());
    apiClient.superadminToolCalls({ ...params, limit: PAGE_SIZE })
      .then((r) => { if (!cancelled) { setRows(r.items); setNextCursor(r.nextCursor); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(errMsg(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    apiClient.superadminToolCallSummary(params)
      .then((r) => { if (!cancelled) { setSummary(r); setSummaryError(null); } })
      .catch((e: unknown) => { if (!cancelled) setSummaryError(errMsg(e)); });
    return () => { cancelled = true; };
  }, [applied]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await apiClient.superadminToolCalls({ ...toParams(applied), limit: PAGE_SIZE, cursor: nextCursor });
      setRows((prev) => [...prev, ...r.items]);
      setNextCursor(r.nextCursor);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoadingMore(false);
    }
  }, [applied, nextCursor]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const byAction = useMemo(() => {
    const m = new Map<string, { ok: number; error: number }>();
    for (const r of summary) {
      const cur = m.get(r.action) ?? { ok: 0, error: 0 };
      cur[r.status] += r.count;
      m.set(r.action, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].ok + b[1].error - (a[1].ok + a[1].error));
  }, [summary]);
  const total = byAction.reduce((n, [, c]) => n + c.ok + c.error, 0);

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const apply = (e: React.FormEvent) => { e.preventDefault(); setApplied(draft); };
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); };
  const pickAction = (action: string) => {
    const next = { ...applied, action: applied.action === action ? '' : action };
    setDraft(next);
    setApplied(next);
  };

  return (
    <main className="relative max-w-7xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Kicker className="mb-3 block">Superadmin</Kicker>
        <h2 className="mt-1 text-4xl font-bold tracking-tight text-ink">Tool Calls</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Every AI agent tool call across all orgs, newest first.
        </p>
      </div>

      <form onSubmit={apply} className="mb-6">
        <Panel padded>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="Org ID"><Input value={draft.orgId} onChange={set('orgId')} placeholder="uuid" /></FilterField>
            <FilterField label="Case ID"><Input value={draft.caseId} onChange={set('caseId')} placeholder="uuid" /></FilterField>
            <FilterField label="Conversation ID"><Input value={draft.conversationId} onChange={set('conversationId')} placeholder="uuid" /></FilterField>
            <FilterField label="User ID"><Input value={draft.userId} onChange={set('userId')} placeholder="uuid" /></FilterField>
            <FilterField label="Action"><Input value={draft.action} onChange={set('action')} placeholder="read_data_room_file" /></FilterField>
            <FilterField label="Status">
              <Select value={draft.status} onChange={set('status')}>
                <option value="">Any</option>
                <option value="ok">ok</option>
                <option value="error">error</option>
              </Select>
            </FilterField>
            <FilterField label="From"><Input type="datetime-local" value={draft.from} onChange={set('from')} /></FilterField>
            <FilterField label="To"><Input type="datetime-local" value={draft.to} onChange={set('to')} /></FilterField>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" size="sm">Apply</Button>
            <Button type="button" size="sm" variant="secondary" onClick={reset}>Reset</Button>
          </div>
        </Panel>
      </form>

      <div className="mb-6">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Counts by action{summary.length > 0 ? ` (${new Intl.NumberFormat('en-US').format(total)} total)` : ''}
        </p>
        {summaryError ? (
          <div className="rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">{summaryError}</div>
        ) : byAction.length === 0 ? (
          <p className="text-sm text-ink-muted">No matching calls.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {byAction.map(([action, c]) => {
              const active = applied.action === action;
              return (
                <button
                  key={action}
                  type="button"
                  onClick={() => pickAction(action)}
                  title={action}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    active ? 'border-brand/40 bg-brand-soft text-brand' : 'border-line bg-surface text-ink-muted hover:bg-surface-raised'
                  }`}
                >
                  {actionLabel(action)}{' '}
                  <span className="font-semibold text-ink">{c.ok + c.error}</span>
                  {c.error > 0 && <span className="ml-1 text-redline">({c.error} failed)</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <Loader inline />
      ) : error ? (
        <div className="rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">{error}</div>
      ) : rows.length === 0 ? (
        <Panel padded><p className="text-sm text-ink-muted">No tool calls match these filters.</p></Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${thClass} w-8`} />
                  <th className={thClass}>Time</th>
                  <th className={thClass}>Org</th>
                  <th className={thClass}>Case</th>
                  <th className={thClass}>User</th>
                  <th className={thClass}>Conversation</th>
                  <th className={thClass}>Source</th>
                  <th className={thClass}>Action</th>
                  <th className={thClass}>Key input</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded.has(r.id);
                  const failed = r.status === 'error';
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => toggle(r.id)}
                        className={`cursor-pointer border-b border-line transition-colors hover:bg-surface-panel ${failed ? 'bg-redline/5' : ''}`}
                      >
                        <td className={`${tdClass} text-ink-faint`}>
                          {open ? <FaChevronDown className="h-3 w-3" /> : <FaChevronRight className="h-3 w-3" />}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-ink-muted`}>{new Date(r.createdAt).toLocaleString()}</td>
                        <td className={`${tdClass} text-ink-muted`}>{r.orgName ?? '—'}</td>
                        <td className={`${tdClass} text-ink-muted`}>{r.caseName ?? '—'}</td>
                        <td className={`${tdClass} text-ink-muted`}>{r.userEmail ?? '—'}</td>
                        <td className={`${tdClass} max-w-[14rem] truncate text-ink-muted`} title={r.conversationId ?? undefined}>
                          {r.conversationId
                            ? (r.conversationTitle ?? <span className="italic text-ink-faint">(untitled or purged)</span>)
                            : '—'}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-ink-muted`}>{sourceLabel({ source: r.source, agent: r.agent ?? null })}</td>
                        <td className={`${tdClass} whitespace-nowrap font-medium text-ink`} title={r.action}>{actionLabel(r.action)}</td>
                        <td className={`${tdClass} max-w-[16rem] truncate font-mono text-xs text-ink-muted`}>{keyInput(r.action, r.input) ?? '—'}</td>
                        <td className={`${tdClass} whitespace-nowrap font-medium ${failed ? 'text-redline' : 'text-ink-muted'}`}>{r.status}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-line bg-surface-panel">
                          <td />
                          <td colSpan={9} className="px-4 py-4">
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                              <div>
                                <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Input</p>
                                <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-surface p-3 text-xs text-ink">{JSON.stringify(r.input, null, 2)}</pre>
                              </div>
                              <div>
                                <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Summary</p>
                                <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-surface p-3 text-xs text-ink">{JSON.stringify(r.summary, null, 2)}</pre>
                              </div>
                            </div>
                            <p className="mt-3 font-mono text-[11px] text-ink-faint">
                              call {r.id} / case {r.caseId}
                              {r.conversationId ? ` / conversation ${r.conversationId}` : ''}
                              {r.backfilled ? ' / backfilled from chat history' : ''}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div className="flex justify-center border-t border-line p-4">
              <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          )}
        </Panel>
      )}
    </main>
  );
}

export default function SuperadminToolCallsPage() {
  return (
    <Suspense fallback={<Loader inline />}>
      <ToolCallsView />
    </Suspense>
  );
}
