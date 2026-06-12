'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaTrash, FaTriangleExclamation, FaXmark } from 'react-icons/fa6';
import { apiClient, type Case } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Delete-confirmation modal — type-the-case-name to confirm
// ---------------------------------------------------------------------------

function DeleteCaseConfirmModal({
  caseToDelete,
  onCancel,
  onConfirm,
}: {
  caseToDelete: Case;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim() === caseToDelete.name;

  const handleConfirm = async () => {
    if (!matches || working) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete case');
      setWorking(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-case-title"
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !working) onCancel();
      }}
    >
      <div className="bg-surface-panel rounded-xl w-full max-w-lg border border-red-500/40 shadow-2xl overflow-hidden">
        {/* Header strip */}
        <div className="flex items-center gap-3 px-6 py-4 bg-red-500/10 border-b border-red-500/30">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
            <FaTriangleExclamation size={18} className="text-red-300" />
          </div>
          <div className="flex-1">
            <h3 id="delete-case-title" className="text-base font-semibold text-white">
              Delete this case?
            </h3>
            <p className="text-xs text-red-200/80 mt-0.5">This action cannot be undone.</p>
          </div>
          <button
            onClick={onCancel}
            disabled={working}
            className="p-1 text-ink-faint hover:text-white transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <FaXmark size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-ink leading-relaxed">
            You are about to permanently delete{' '}
            <span className="font-semibold text-white">&ldquo;{caseToDelete.name}&rdquo;</span>{' '}
            and everything it contains:
          </p>
          <ul className="text-sm text-ink-muted space-y-1.5 pl-4 list-disc list-outside">
            <li>All investigations and their traces (graph data)</li>
            <li>All productions and exports</li>
            <li>All case members and their access</li>
            <li>The associated data room is detached</li>
          </ul>
          <p className="text-sm text-ink-muted">
            This cannot be recovered. To proceed, type the case name below.
          </p>

          <div>
            <label
              htmlFor="confirm-case-name"
              className="block text-xs uppercase tracking-wider text-ink-faint mb-1.5 font-semibold"
            >
              Type <span className="text-white">{caseToDelete.name}</span> to confirm
            </label>
            <input
              id="confirm-case-name"
              type="text"
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={working}
              placeholder={caseToDelete.name}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder:text-ink-faint/60 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-surface/40 border-t border-line-strong/60">
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="px-4 py-2 rounded-lg bg-surface-raised hover:bg-surface-raised/80 text-sm text-ink-muted hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!matches || working}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FaTrash size={12} />
            {working ? 'Deleting…' : 'Delete case'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cases admin section
// ---------------------------------------------------------------------------

export function OrgCasesAdminSection({ orgId }: { orgId: string }) {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Case | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const all = await apiClient.listCases();
      setCases(all.filter((c) => c.orgId === orgId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load cases');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleting) return;
    await apiClient.deleteCase(deleting.id);
    setDeleting(null);
    await load();
  };

  return (
    <div className="relative mb-6 p-6 rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] overflow-hidden">
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <h2 className="text-base font-semibold text-white mb-1">Cases (admin only)</h2>
      <p className="text-xs text-ink-muted mb-5">
        As an org admin you have implicit owner access on every case in this organization.
        Deleting a case permanently removes its investigations, productions, members, and all
        related data.
      </p>

      {error && (
        <div className="px-3 py-2 mb-4 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : cases.length === 0 ? (
        <p className="text-sm text-ink-muted">No cases in this organization.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface/60 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">Case</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="w-12 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-line-strong/50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-white">{c.name}</div>
                    {c.summary && (
                      <div className="text-xs text-ink-muted mt-0.5 line-clamp-1">{c.summary}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted whitespace-nowrap">
                    {formatDate(c.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleting(c)}
                      className="p-1.5 text-ink-faint hover:text-red-400 transition-colors"
                      title="Delete case"
                      aria-label={`Delete case ${c.name}`}
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

      {deleting && (
        <DeleteCaseConfirmModal
          caseToDelete={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
