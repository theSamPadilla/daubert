'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { FaTrash, FaPlus, FaCircleCheck, FaCircleExclamation, FaShield } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';
import { ErrorModal } from '@/components/Common/ErrorModal';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { Button, IconButton, Input, Kicker, Panel } from '@/components/ui';

type UserSummary = components['schemas']['UserSummary'];

const emptyForm = { email: '', name: '' };

export default function SuperadminUsersPage() {
  const confirm = useConfirm();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const data = await apiClient.superadminListUsers();
      setUsers(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || !form.name.trim()) {
      setErrorMessage('Email and name are required');
      return;
    }
    setSaving(true);
    try {
      await apiClient.superadminCreateUser({
        email: form.email.trim(),
        name: form.name.trim(),
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSuperAdmin = async (user: UserSummary) => {
    const adding = !user.isSuperAdmin;
    const ok = await confirm({
      title: adding ? 'Grant superadmin?' : 'Remove superadmin?',
      message: adding
        ? <>Grant superadmin privileges to <span className="text-ink font-medium">{user.email}</span>?</>
        : <>Remove superadmin privileges from <span className="text-ink font-medium">{user.email}</span>?</>,
      confirmLabel: adding ? 'Grant' : 'Remove',
      destructive: !adding,
    });
    if (!ok) return;
    try {
      await apiClient.superadminSetSuperAdmin(user.id, !user.isSuperAdmin);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update superadmin status');
    }
  };

  const handleDelete = async (user: UserSummary) => {
    const ok = await confirm({
      title: 'Hard-delete user?',
      message: (
        <>
          Delete <span className="text-ink font-medium">{user.email}</span> permanently. This cascades through
          all memberships and cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.superadminDeleteUser(user.id);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  return (
    <main className="relative max-w-5xl mx-auto px-6 py-12">
      <div className="mb-10 flex items-start justify-between gap-6">
        <div>
          <Kicker className="mb-3 block">Superadmin</Kicker>
          <h2 className="mt-1 text-4xl font-bold tracking-tight text-ink">
            Users
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Create user shells and manage superadmin access. Users bind to Firebase on first sign-in.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)} className="shrink-0 mt-1">
          <FaPlus className="h-3 w-3" /> Add user
        </Button>
      </div>

      {loadError && (
        <div className="mb-6 rounded-lg border border-redline/40 bg-redline/10 p-3 text-sm text-redline">
          {loadError}
        </div>
      )}

      {showForm && (
        <Panel padded className="mb-6 border-line-strong">
          <h3 className="mb-5 text-base font-semibold text-ink">New user</h3>
          <form onSubmit={handleCreate}>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm text-ink-muted">Email</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                  required
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-ink-muted">Name</label>
                <Input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  required
                  placeholder="Jane Doe"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating...' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setShowForm(false); setForm(emptyForm); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {loading ? (
        <Loader inline />
      ) : users.length === 0 ? (
        <Panel className="py-16 text-center">
          <p className="text-sm text-ink-muted">No users yet.</p>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Email</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Name</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Linked</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Superadmin</th>
                <th className="px-4 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint">Created</th>
                <th className="w-20 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-line hover:bg-surface-panel transition-colors">
                  <td className="px-4 py-3 text-sm text-ink">{u.email}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">{u.name}</td>
                  <td className="px-4 py-3 text-sm">
                    {u.linked ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <FaCircleCheck className="h-3 w-3" /> Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600" title="User has not signed in to Firebase yet">
                        <FaCircleExclamation className="h-3 w-3" /> Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {u.isSuperAdmin ? (
                      <span className="inline-flex items-center gap-1 text-brand">
                        <FaShield className="h-3 w-3" /> Yes
                      </span>
                    ) : (
                      <span className="text-ink-faint">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink-muted">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        aria-label={u.isSuperAdmin ? 'Revoke superadmin' : 'Grant superadmin'}
                        onClick={() => handleToggleSuperAdmin(u)}
                        className={u.isSuperAdmin ? 'text-brand hover:text-brand-strong' : 'text-ink-faint hover:text-brand'}
                      >
                        <FaShield className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        aria-label="Delete user"
                        onClick={() => handleDelete(u)}
                        className="text-ink-faint hover:text-redline hover:bg-redline/10"
                      >
                        <FaTrash className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <ErrorModal
        open={!!errorMessage}
        message={errorMessage ?? ''}
        onClose={() => setErrorMessage(null)}
      />
    </main>
  );
}
