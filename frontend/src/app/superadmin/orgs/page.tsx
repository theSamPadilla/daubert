'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { FaPlus, FaTrash } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';
import { ErrorModal } from '@/components/Common/ErrorModal';

type OrgSummary = components['schemas']['OrgSummary'];

interface DeleteConfirmState {
  org: OrgSummary;
  typed: string;
}

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand transition-colors';

const primaryBtn =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand hover:bg-brand/90 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const secondaryBtn =
  'px-4 py-2 rounded-lg text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted hover:text-white transition-colors';

const dangerBtn =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export default function SuperadminOrgsPage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formAdminEmail, setFormAdminEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await apiClient.superadminListOrgs();
      setOrgs(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load orgs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formAdminEmail.trim()) {
      setErrorMessage('Name and first admin email are required');
      return;
    }
    setSaving(true);
    try {
      await apiClient.superadminCreateOrg({
        name: formName.trim(),
        slug: formSlug.trim() || undefined,
        firstAdminEmail: formAdminEmail.trim(),
      });
      setFormName('');
      setFormSlug('');
      setFormAdminEmail('');
      setShowForm(false);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create org');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiClient.superadminDeleteOrg(deleteConfirm.org.id);
      setDeleteConfirm(null);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete org');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="relative max-w-5xl mx-auto px-6 py-12">
      <div className="mb-10 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-brand-ink to-transparent" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
              Superadmin
            </span>
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">
            Organizations
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Create organizations and assign first admins. Deleted orgs are soft-deleted (30-day retention).
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className={`${primaryBtn} shrink-0 mt-1`}>
          <FaPlus className="h-3 w-3" /> New org
        </button>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="relative mb-6 p-6 rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] overflow-hidden"
        >
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <h3 className="mb-5 text-base font-semibold text-white">New organization</h3>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                className={inputClass}
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Slug (optional)</label>
              <input
                type="text"
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value)}
                className={`${inputClass} font-mono`}
                placeholder="auto-derived from name"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-sm text-ink-muted">First admin email</label>
            <input
              type="email"
              value={formAdminEmail}
              onChange={(e) => setFormAdminEmail(e.target.value)}
              required
              className={inputClass}
              placeholder="admin@example.com"
            />
            <p className="mt-1 text-xs text-ink-faint">
              If the user exists they are promoted to admin. Otherwise a shell user is created pending sign-in.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={saving} className={primaryBtn}>
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormName(''); setFormSlug(''); setFormAdminEmail(''); }}
              className={secondaryBtn}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <Loader inline />
      ) : orgs.length === 0 ? (
        <div className="rounded-xl border border-line-strong/60 bg-surface-panel/50 py-16 text-center">
          <p className="text-sm text-ink-muted">No organizations yet.</p>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-line-strong/60 bg-surface-panel shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Cases</th>
                <th className="px-4 py-3">Created</th>
                <th className="w-16 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-white">{org.name}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted font-mono">{org.slug}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{org.memberCount}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{org.caseCount}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleteConfirm({ org, typed: '' })}
                      className="p-1.5 text-ink-faint hover:text-red-400 transition-colors"
                      title="Delete org"
                    >
                      <FaTrash className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="relative bg-surface-panel border border-line-strong rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
            <h3 className="text-base font-semibold text-white">Delete organization?</h3>
            <p className="text-sm text-ink-muted">
              This will soft-delete <span className="text-white font-medium">{deleteConfirm.org.name}</span>.
              The org and its data are retained for 30 days. Type the org name to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirm.typed}
              onChange={(e) => setDeleteConfirm((s) => s ? { ...s, typed: e.target.value } : null)}
              className={`${inputClass} focus:border-red-500`}
              placeholder={deleteConfirm.org.name}
            />
            <div className="flex items-center gap-2 justify-end pt-1">
              <button onClick={() => setDeleteConfirm(null)} className={secondaryBtn}>
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirm.typed !== deleteConfirm.org.name || deleting}
                className={dangerBtn}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ErrorModal
        open={!!errorMessage}
        message={errorMessage ?? ''}
        onClose={() => setErrorMessage(null)}
      />
    </main>
  );
}
