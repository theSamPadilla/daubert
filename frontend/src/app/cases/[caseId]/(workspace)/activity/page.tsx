'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaChevronDown, FaChevronRight } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';
import { Loader } from '@/components/Common/Loader';
import { actionLabel, keyInput, sourceLabel } from '@/components/Workspace/activityFormat';

type Entry = components['schemas']['CaseActivityEntry'];

const PAGE_SIZE = 50;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function ActivityRow({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  const key = keyInput(entry.action, entry.input);
  const who = entry.user?.name || entry.user?.email || 'Case member';
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-raised transition-colors"
        aria-expanded={open}
      >
        {open ? <FaChevronDown size={10} className="text-ink-faint shrink-0" /> : <FaChevronRight size={10} className="text-ink-faint shrink-0" />}
        <span className="w-40 shrink-0 text-xs text-ink-muted">{formatTime(entry.createdAt)}</span>
        <span className="flex-1 min-w-0">
          <span className="text-sm font-medium text-ink">{actionLabel(entry.action)}</span>
          {key && <span className="ml-2 font-mono text-xs text-ink-muted truncate">{key}</span>}
        </span>
        <span className="w-36 shrink-0 truncate text-xs text-ink-muted">{who}</span>
        <span className="w-32 shrink-0 truncate rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-muted text-center">
          {sourceLabel(entry)}
        </span>
        <span className={`w-14 shrink-0 text-right text-xs ${entry.status === 'error' ? 'text-redline' : 'text-ink-faint'}`}>
          {entry.status === 'error' ? 'Failed' : 'OK'}
        </span>
      </button>
      {open && (
        <div className="grid gap-3 px-11 pb-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Input</p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-raised p-3 text-xs text-ink-soft whitespace-pre-wrap break-all">
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Result</p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-surface-raised p-3 text-xs text-ink-soft whitespace-pre-wrap break-all">
              {entry.summary ? JSON.stringify(entry.summary, null, 2) : 'No summary'}
            </pre>
            <p className="mt-2 text-[11px] text-ink-faint">
              {entry.agent ? `Agent: ${entry.agent}` : null}
              {entry.backfilled ? ' · Rebuilt from chat history' : null}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

export default function ActivityPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const [items, setItems] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null) => {
      const page = await apiClient.listCaseActivity(caseId, from, PAGE_SIZE);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    },
    [caseId],
  );

  useEffect(() => {
    setLoading(true);
    load(null)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load activity'))
      .finally(() => setLoading(false));
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      await load(cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader title="Activity" rightContent={<UserMenu />} />
      <div className="flex-1 overflow-y-auto p-6">
        <p className="mb-4 max-w-2xl text-sm text-ink-muted">
          Every action an AI agent took on this case, from Daubert chat and from connected agents. Entries are kept with
          the case and cannot be edited or deleted.
        </p>
        {error && (
          <div className="mb-4 rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">{error}</div>
        )}
        {loading ? (
          <Loader inline />
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">No agent activity on this case yet.</p>
        ) : (
          <>
            <ul className="rounded-xl border border-line bg-surface">
              {items.map((e) => (
                <ActivityRow key={e.id} entry={e} />
              ))}
            </ul>
            {cursor && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm text-ink hover:bg-surface-raised disabled:opacity-60"
                >
                  {loadingMore ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
