'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { apiClient, type AdminUser, type Case, type CaseMember, type CaseRole } from '@/lib/api-client';
import { FaTrash, FaPlus, FaChevronDown, FaChevronRight, FaUserPlus } from 'react-icons/fa6';
import { Loader } from '@/components/Loader';

export default function AdminCasesPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create-case form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', ownerUserId: '' });
  const [saving, setSaving] = useState(false);

  // Member management per case (lazy-loaded)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, CaseMember[]>>({});
  const [memberError, setMemberError] = useState<Record<string, string>>({});
  const [addMemberForm, setAddMemberForm] = useState<Record<string, { userId: string; role: CaseRole }>>({});

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [c, u] = await Promise.all([apiClient.adminListCases(), apiClient.adminListUsers()]);
      setCases(c);
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadMembers = async (caseId: string) => {
    try {
      const data = await apiClient.adminListCaseMembers(caseId);
      setMembers((m) => ({ ...m, [caseId]: data }));
      setMemberError((e) => ({ ...e, [caseId]: '' }));
    } catch (err) {
      setMemberError((e) => ({ ...e, [caseId]: err instanceof Error ? err.message : 'Failed to load members' }));
    }
  };

  const toggleExpand = (caseId: string) => {
    if (expandedId === caseId) {
      setExpandedId(null);
    } else {
      setExpandedId(caseId);
      if (!members[caseId]) loadMembers(caseId);
      if (!addMemberForm[caseId]) {
        setAddMemberForm((f) => ({ ...f, [caseId]: { userId: '', role: 'guest' } }));
      }
    }
  };

  const handleCreateCase = async () => {
    if (!form.name.trim() || !form.ownerUserId) {
      alert('Name and owner are required');
      return;
    }
    setSaving(true);
    try {
      await apiClient.adminCreateCase({ name: form.name.trim(), ownerUserId: form.ownerUserId });
      setForm({ name: '', ownerUserId: '' });
      setShowForm(false);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create case');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCase = async (c: Case) => {
    if (!window.confirm(`Delete case "${c.name}"? This cannot be undone.`)) return;
    try {
      await apiClient.adminDeleteCase(c.id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete case');
    }
  };

  const handleAddMember = async (caseId: string) => {
    const f = addMemberForm[caseId];
    if (!f?.userId) return;
    try {
      await apiClient.adminAddCaseMember(caseId, f);
      setAddMemberForm((s) => ({ ...s, [caseId]: { userId: '', role: 'guest' } }));
      await loadMembers(caseId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add member');
    }
  };

  const handleChangeRole = async (caseId: string, userId: string, role: CaseRole) => {
    try {
      await apiClient.adminUpdateCaseMemberRole(caseId, userId, role);
      await loadMembers(caseId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleRemoveMember = async (caseId: string, userId: string, email: string) => {
    if (!window.confirm(`Remove ${email} from this case?`)) return;
    try {
      await apiClient.adminRemoveCaseMember(caseId, userId);
      await loadMembers(caseId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to remove member');
    }
  };

  // Users not already members of the given case
  const candidateUsers = (caseId: string) => {
    const memberIds = new Set((members[caseId] ?? []).map((m) => m.userId));
    return users.filter((u) => !memberIds.has(u.id));
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Cases</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create cases, assign owners, manage guest access.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
        >
          <FaPlus className="h-3 w-3" /> Add case
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded bg-red-900/50 p-3 text-sm text-red-300">{error}</div>
      )}

      {showForm && (
        <div className="mb-6 rounded-lg border border-gray-700 bg-gray-800 p-4">
          <h2 className="mb-4 text-lg font-semibold text-white">New case</h2>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-gray-400">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
                placeholder="Case name"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-400">Owner</label>
              <select
                value={form.ownerUserId}
                onChange={(e) => setForm((s) => ({ ...s, ownerUserId: e.target.value }))}
                className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select owner...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreateCase}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm({ name: '', ownerUserId: '' }); }}
              className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : cases.length === 0 ? (
        <p className="py-12 text-center text-gray-400">No cases yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-700">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800/50 text-left text-sm text-gray-400">
                <th className="w-8 px-4 py-3"></th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Created</th>
                <th className="w-16 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const expanded = expandedId === c.id;
                const caseMembers = members[c.id] ?? [];
                const candidates = candidateUsers(c.id);
                const memForm = addMemberForm[c.id] ?? { userId: '', role: 'guest' as CaseRole };

                return (
                  <Fragment key={c.id}>
                    <tr
                      className="cursor-pointer border-b border-gray-700/50 hover:bg-gray-800/50"
                      onClick={() => toggleExpand(c.id)}
                    >
                      <td className="px-4 py-3 text-gray-500">
                        {expanded ? <FaChevronDown className="h-3 w-3" /> : <FaChevronRight className="h-3 w-3" />}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-white">{c.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteCase(c); }}
                          className="p-1.5 text-gray-500 hover:text-red-400"
                          title="Delete case"
                        >
                          <FaTrash className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-gray-800/30">
                        <td colSpan={4} className="px-4 py-4">
                          <div className="space-y-4">
                            <div>
                              <span className="text-xs uppercase tracking-wider text-gray-500">Members</span>
                              {memberError[c.id] && (
                                <p className="mt-2 text-sm text-red-400">{memberError[c.id]}</p>
                              )}
                              {caseMembers.length === 0 && !memberError[c.id] ? (
                                <p className="mt-2 text-sm text-gray-500">No members.</p>
                              ) : (
                                <table className="mt-2 w-full">
                                  <tbody>
                                    {caseMembers.map((m) => (
                                      <tr key={m.id} className="border-t border-gray-700/30">
                                        <td className="py-2 text-sm text-white">
                                          {m.user?.name ?? m.userId}
                                          {m.user?.email && (
                                            <span className="ml-2 text-xs text-gray-500">{m.user.email}</span>
                                          )}
                                        </td>
                                        <td className="py-2">
                                          <select
                                            value={m.role}
                                            onChange={(e) => handleChangeRole(c.id, m.userId, e.target.value as CaseRole)}
                                            className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white"
                                          >
                                            <option value="owner">owner</option>
                                            <option value="guest">guest</option>
                                          </select>
                                        </td>
                                        <td className="py-2 text-right">
                                          <button
                                            onClick={() => handleRemoveMember(c.id, m.userId, m.user?.email ?? m.userId)}
                                            className="p-1 text-gray-500 hover:text-red-400"
                                            title="Remove"
                                          >
                                            <FaTrash className="h-3 w-3" />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>

                            <div className="border-t border-gray-700/30 pt-3">
                              <span className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
                                Add member
                              </span>
                              {candidates.length === 0 ? (
                                <p className="text-sm text-gray-500">
                                  All users are already members of this case.
                                </p>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <select
                                    value={memForm.userId}
                                    onChange={(e) => setAddMemberForm((s) => ({ ...s, [c.id]: { ...memForm, userId: e.target.value } }))}
                                    className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white"
                                  >
                                    <option value="">Select user...</option>
                                    {candidates.map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.name} ({u.email})
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={memForm.role}
                                    onChange={(e) => setAddMemberForm((s) => ({ ...s, [c.id]: { ...memForm, role: e.target.value as CaseRole } }))}
                                    className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white"
                                  >
                                    <option value="guest">guest</option>
                                    <option value="owner">owner</option>
                                  </select>
                                  <button
                                    onClick={() => handleAddMember(c.id)}
                                    disabled={!memForm.userId}
                                    className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                                  >
                                    <FaUserPlus className="h-3 w-3" /> Add
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
