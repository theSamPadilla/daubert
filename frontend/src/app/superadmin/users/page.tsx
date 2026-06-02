'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { FaTrash, FaPlus, FaCircleCheck, FaCircleExclamation, FaShield } from 'react-icons/fa6';
import { Loader } from '@/components/Common/Loader';
import { ErrorModal } from '@/components/Common/ErrorModal';

type UserSummary = components['schemas']['UserSummary'];

const emptyForm = { email: '', name: '' };

export default function SuperadminUsersPage() {
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
    const action = user.isSuperAdmin ? 'Remove superadmin from' : 'Grant superadmin to';
    if (!window.confirm(`${action} ${user.email}?`)) return;
    try {
      await apiClient.superadminSetSuperAdmin(user.id, !user.isSuperAdmin);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update superadmin status');
    }
  };

  const handleDelete = async (user: UserSummary) => {
    if (!window.confirm(`Hard-delete ${user.email}? This cascades through all memberships and cannot be undone.`)) return;
    try {
      await apiClient.superadminDeleteUser(user.id);
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Create user shells and manage superadmin access. Users bind to Firebase on first sign-in.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand/90"
        >
          <FaPlus className="h-3 w-3" /> Add user
        </button>
      </div>

      {loadError && (
        <div className="mb-4 rounded bg-red-900/50 p-3 text-sm text-red-300">{loadError}</div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 rounded-lg border border-line-strong bg-surface-panel p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">New user</h2>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-ink-muted">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                required
                className="w-full rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
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
                className="w-full rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                placeholder="Jane Doe"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand/90 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(emptyForm); }}
              className="rounded bg-surface-raised px-3 py-1.5 text-sm text-ink-muted hover:bg-surface-raised/80"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <Loader inline />
      ) : users.length === 0 ? (
        <p className="py-12 text-center text-ink-muted">No users yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-panel/50 text-left text-sm text-ink-muted">
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
                <tr key={u.id} className="border-b border-line-strong/50">
                  <td className="px-4 py-3 text-sm text-white">{u.email}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{u.name}</td>
                  <td className="px-4 py-3 text-sm">
                    {u.linked ? (
                      <span className="inline-flex items-center gap-1 text-green-400">
                        <FaCircleCheck className="h-3 w-3" /> Yes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-yellow-400" title="User has not signed in to Firebase yet">
                        <FaCircleExclamation className="h-3 w-3" /> Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {u.isSuperAdmin ? (
                      <span className="inline-flex items-center gap-1 text-blue-400">
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
                        className={`p-1.5 transition-colors ${u.isSuperAdmin ? 'text-blue-400 hover:text-blue-200' : 'text-ink-faint hover:text-blue-400'}`}
                        title={u.isSuperAdmin ? 'Revoke superadmin' : 'Grant superadmin'}
                      >
                        <FaShield className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1.5 text-ink-faint hover:text-red-400"
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
    </div>
  );
}
