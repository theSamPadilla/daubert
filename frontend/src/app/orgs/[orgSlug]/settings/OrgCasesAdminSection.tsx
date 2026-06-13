'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaTrash, FaTriangleExclamation, FaXmark } from 'react-icons/fa6';
import { apiClient, type Case } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';
import { Panel } from '@/components/ui/Panel';
import { Kicker } from '@/components/ui/Kicker';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

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
      className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !working) onCancel();
      }}
    >
      <div className="bg-surface rounded-xl w-full max-w-lg border border-redline/30 shadow-lg overflow-hidden">
        {/* Header strip */}
        <div className="flex items-center gap-3 px-6 py-4 bg-redline/5 border-b border-redline/20">
          <div className="w-10 h-10 rounded-full bg-redline/10 flex items-center justify-center">
            <FaTriangleExclamation size={18} className="text-redline" />
          </div>
          <div className="flex-1">
            <h3 id="delete-case-title" className="text-base font-semibold text-ink">
              Delete this case?
            </h3>
            <p className="text-xs text-redline/80 mt-0.5">This action cannot be undone.</p>
          </div>
          <button
            onClick={onCancel}
            disabled={working}
            className="p-1 text-ink-faint hover:text-ink transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <FaXmark size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-ink leading-relaxed">
            You are about to permanently delete{' '}
            <span className="font-semibold text-ink">&ldquo;{caseToDelete.name}&rdquo;</span>{' '}
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
              Type <span className="text-ink">{caseToDelete.name}</span> to confirm
            </label>
            <Input
              id="confirm-case-name"
              type="text"
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={working}
              placeholder={caseToDelete.name}
              className="focus:border-redline focus-visible:ring-redline/30"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 bg-surface-raised border-t border-line">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={working}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleConfirm}
            disabled={!matches || working}
          >
            <FaTrash size={12} />
            {working ? 'Deleting…' : 'Delete case'}
          </Button>
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
    <Panel padded className="mb-6">
      <Kicker index={4} className="block mb-1">Cases (admin only)</Kicker>
      <p className="text-xs text-ink-muted mb-5">
        As an org admin you have implicit owner access on every case in this organization.
        Deleting a case permanently removes its investigations, productions, members, and all
        related data.
      </p>

      {error && (
        <div className="px-3 py-2 mb-4 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
          {error}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : cases.length === 0 ? (
        <p className="text-sm text-ink-muted">No cases in this organization.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-raised text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">Case</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="w-12 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-ink">{c.name}</div>
                    {c.summary && (
                      <div className="text-[13px] text-ink-muted mt-0.5 line-clamp-1">{c.summary}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted whitespace-nowrap">
                    {formatDate(c.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleting(c)}
                      className="p-1.5 text-ink-faint hover:text-redline transition-colors"
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
    </Panel>
  );
}
