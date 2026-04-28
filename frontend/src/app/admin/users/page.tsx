'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient, type AdminUser, type Case, type CaseRole } from '@/lib/api-client';
import { FaTrash, FaPlus, FaCircleCheck, FaCircleExclamation } from 'react-icons/fa6';
import { Loader } from '@/components/Loader';

interface FormState {
  email: string;
  name: string;
  caseId: string;        // '' means no case
  caseRole: CaseRole;
}

const emptyForm: FormState = { email: '', name: '', caseId: '', caseRole: 'guest' };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [u, c] = await Promise.all([apiClient.adminListUsers(), apiClient.adminListCases()]);
      setUsers(u);
      setCases(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async () => {
    if (!form.email.trim() || !form.name.trim()) {
      alert('Email and name are required');
      return;
    }
    setSaving(true);
    try {
      const body: { email: string; name: string; caseId?: string; caseRole?: CaseRole } = {
        email: form.email.trim(),
        name: form.name.trim(),
      };
      if (form.caseId) {
        body.caseId = form.caseId;
        body.caseRole = form.caseRole;
      }
      await apiClient.adminCreateUser(body);
      setForm(emptyForm);
      setShowForm(false);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user: AdminUser) => {
    if (!window.confirm(`Hard-delete ${user.email}? This cascades through case memberships and conversations and cannot be undone.`)) return;
    try {
      await apiClient.adminDeleteUser(user.id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Users</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create user shells. The user binds to Firebase on first sign-in with the matching email.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
        >
          <FaPlus className="h-3 w-3" /> Add user
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded bg-red-900/50 p-3 text-sm text-red-300">{error}</div>
      )}

      {showForm && (
        <div className="mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">New user</h2>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                placeholder="Jane Doe"
              />
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400">Add to case (optional)</label>
              <select
                value={form.caseId}
                onChange={(e) => setForm((s) => ({ ...s, caseId: e.target.value }))}
                className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">No case</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Role</label>
              <select
                value={form.caseRole}
                onChange={(e) => setForm((s) => ({ ...s, caseRole: e.target.value as CaseRole }))}
                disabled={!form.caseId}
                className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
              >
                <option value="guest">guest</option>
                <option value="owner">owner</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(emptyForm); }}
              className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : users.length === 0 ? (
        <p className="py-12 text-center text-gray-400">No users yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-700">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800/50 text-left text-sm text-gray-400">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Linked</th>
                <th className="px-4 py-3">Created</th>
                <th className="w-16 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-700/50">
                  <td className="px-4 py-3 text-sm text-white">{u.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{u.name}</td>
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
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(u)}
                      className="p-1.5 text-gray-500 hover:text-red-400"
                      title="Delete"
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
    </div>
  );
}
