'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { FaTrash, FaPlus, FaCircleCheck, FaCircleExclamation, FaShield } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';
import { ErrorModal } from '@/components/Common/ErrorModal';
import { useConfirm } from '@/components/Common/ConfirmProvider';

type UserSummary = components['schemas']['UserSummary'];

const emptyForm = { email: '', name: '' };

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand transition-colors';

const primaryBtn =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand hover:bg-brand/90 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const secondaryBtn =
  'px-4 py-2 rounded-lg text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted hover:text-white transition-colors';

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
        ? <>Grant superadmin privileges to <span className="text-white">{user.email}</span>?</>
        : <>Remove superadmin privileges from <span className="text-white">{user.email}</span>?</>,
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
          Delete <span className="text-white">{user.email}</span> permanently. This cascades through
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
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-brand to-transparent" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              Superadmin
            </span>
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">
            Users
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Create user shells and manage superadmin access. Users bind to Firebase on first sign-in.
          </p>
        </div>
        <button onClick={() => setShowForm((s) => !s)} className={`${primaryBtn} shrink-0 mt-1`}>
          <FaPlus className="h-3 w-3" /> Add user
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
          <h3 className="mb-5 text-base font-semibold text-white">New user</h3>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                required
                className={inputClass}
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                required
                className={inputClass}
                placeholder="Jane Doe"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={saving} className={primaryBtn}>
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(emptyForm); }}
              className={secondaryBtn}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <Loader inline />
      ) : users.length === 0 ? (
        <div className="rounded-xl border border-line-strong/60 bg-surface-panel/50 py-16 text-center">
          <p className="text-sm text-ink-muted">No users yet.</p>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-xl border border-line-strong/60 bg-surface-panel shadow-[0_2px_12px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <table className="w-full">
            <thead>
              <tr className="bg-surface/40 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Linked</th>
                <th className="px-4 py-3">Superadmin</th>
                <th className="px-4 py-3">Created</th>
                <th className="w-20 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line-strong/40 hover:bg-white/[0.02] transition-colors">
                  <td className="px-4 py-3 text-sm text-white">{u.email}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{u.name}</td>
                  <td className="px-4 py-3 text-sm">
                    {u.linked ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <FaCircleCheck className="h-3 w-3" /> Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-400" title="User has not signed in to Firebase yet">
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
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleToggleSuperAdmin(u)}
                        className={`p-1.5 transition-colors ${u.isSuperAdmin ? 'text-brand hover:text-white' : 'text-ink-faint hover:text-brand'}`}
                        title={u.isSuperAdmin ? 'Revoke superadmin' : 'Grant superadmin'}
                      >
                        <FaShield className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 text-ink-faint hover:text-red-400 transition-colors"
                        title="Delete user"
                      >
                        <FaTrash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
