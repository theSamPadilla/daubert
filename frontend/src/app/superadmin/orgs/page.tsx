'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { FaPlus, FaTrash } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';
import { ErrorModal } from '@/components/Common/ErrorModal';
import { Button, IconButton, Input, Kicker, Modal, Panel } from '@/components/ui';

type OrgSummary = components['schemas']['OrgSummary'];

interface DeleteConfirmState {
  org: OrgSummary;
  typed: string;
}

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
          <Kicker className="mb-3 block">Superadmin</Kicker>
          <h2 className="mt-1 text-4xl font-bold tracking-tight text-ink">
            Organizations
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Create organizations and assign first admins. Deleted orgs are soft-deleted (30-day retention).
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0 mt-1">
          <FaPlus className="h-3 w-3" /> New org
        </Button>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">
          {loadError}
        </div>
      )}

      {showForm && (
        <Panel padded className="mb-6 border-line-strong">
          <h3 className="mb-5 text-base font-semibold text-ink">New organization</h3>
          <form onSubmit={handleCreate}>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm text-ink-muted">Name</label>
                <Input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-ink-muted">Slug (optional)</label>
                <Input
                  type="text"
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  className="font-mono"
                  placeholder="auto-derived from name"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-sm text-ink-muted">First admin email</label>
              <Input
                type="email"
                value={formAdminEmail}
                onChange={(e) => setFormAdminEmail(e.target.value)}
                required
                placeholder="admin@example.com"
              />
              <p className="mt-1 text-xs text-ink-faint">
                If the user exists they are promoted to admin. Otherwise a shell user is created pending sign-in.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setShowForm(false); setFormName(''); setFormSlug(''); setFormAdminEmail(''); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {loading ? (
        <Loader inline />
      ) : orgs.length === 0 ? (
        <Panel className="py-16 text-center">
          <p className="text-sm text-ink-muted">No organizations yet.</p>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Name</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Slug</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Members</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Cases</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Created</th>
                <th className="w-16 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-line hover:bg-surface-panel transition-colors">
                  <td className="px-4 py-3 text-sm text-ink font-medium">{org.name}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted font-mono">{org.slug}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">{org.memberCount}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">{org.caseCount}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <IconButton
                      aria-label="Delete org"
                      onClick={() => setDeleteConfirm({ org, typed: '' })}
                      className="text-ink-faint hover:text-redline hover:bg-redline/10"
                    >
                      <FaTrash className="h-3.5 w-3.5" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {deleteConfirm && (
        <Modal
          open
          title="Delete organization?"
          onClose={() => setDeleteConfirm(null)}
          maxWidth="max-w-sm"
          footer={
            <div className="flex items-center gap-2 justify-end">
              <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={deleteConfirm.typed !== deleteConfirm.org.name || deleting}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink-muted mb-4">
            This will soft-delete <span className="text-ink font-medium">{deleteConfirm.org.name}</span>.
            The org and its data are retained for 30 days. Type the org name to confirm.
          </p>
          <Input
            type="text"
            value={deleteConfirm.typed}
            onChange={(e) => setDeleteConfirm((s) => s ? { ...s, typed: e.target.value } : null)}
            placeholder={deleteConfirm.org.name}
          />
        </Modal>
      )}

      <ErrorModal
        open={!!errorMessage}
        message={errorMessage ?? ''}
        onClose={() => setErrorMessage(null)}
      />
    </main>
  );
}
