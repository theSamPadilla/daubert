'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FaXmark, FaTrash, FaPlus, FaCopy, FaCheck } from 'react-icons/fa6';
import { useOrgContext } from '@/contexts/OrgContext';
import { useAuth } from '@/components/Auth/AuthProvider';
import { apiClient, type OrgMemberRole } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';

type OrgMember = components['schemas']['OrganizationMember'];
type OrgInvite = components['schemas']['OrganizationInvite'];
type OrgInviteRole = components['schemas']['OrgInviteRole'];

function Banner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 mb-6 rounded border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="hover:text-white transition-colors">
        <FaXmark size={14} />
      </button>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line-strong bg-surface-panel p-6 mb-6">
      <h2 className="text-base font-semibold text-white mb-4">{title}</h2>
      {children}
    </div>
  );
}

function RolePill({ role }: { role: OrgMemberRole }) {
  const colors: Record<OrgMemberRole, string> = {
    admin: 'bg-blue-900/40 text-blue-300',
    member: 'bg-emerald-900/40 text-emerald-300',
    guest: 'bg-surface-raised text-ink-muted',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[role]}`}>
      {role}
    </span>
  );
}

function OrgInfoSection({
  orgSlug,
  isAdmin,
}: {
  orgSlug: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { setActiveOrgSlug } = useOrgContext();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.getOrg(orgSlug).then((o) => {
      setName(o.name);
      setSlug(o.slug);
    }).catch((e: Error) => setError(e.message));
  }, [orgSlug]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient.updateOrg(orgSlug, { name, slug });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (updated.slug !== orgSlug) {
        setActiveOrgSlug(updated.slug);
        router.replace(`/orgs/${updated.slug}/settings`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Organization info">
      {error && <Banner message={error} onClose={() => setError(null)} />}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm text-ink-muted mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            className="w-full bg-surface border border-line-strong rounded px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-sm text-ink-muted mb-1">Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!isAdmin}
            className="w-full bg-surface border border-line-strong rounded px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand disabled:opacity-60 font-mono"
          />
          {isAdmin && (
            <p className="mt-1 text-xs text-ink-faint">
              Changing the slug will update the URL and break any existing links.
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !name.trim() || !slug.trim()}
              className="px-3 py-1.5 rounded text-sm bg-brand hover:bg-brand/90 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        )}
      </form>
    </SectionCard>
  );
}

function MembersSection({
  orgSlug,
  isAdmin,
  currentUserId,
}: {
  orgSlug: string;
  isAdmin: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listOrgMembers(orgSlug);
      setMembers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { load(); }, [load]);

  const handleRoleChange = async (userId: string, role: OrgMemberRole) => {
    try {
      await apiClient.updateOrgMemberRole(orgSlug, userId, { role });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    }
  };

  const handleRemove = async (userId: string, email: string) => {
    if (!window.confirm(`Remove ${email} from this organization?`)) return;
    try {
      await apiClient.removeOrgMember(orgSlug, userId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    }
  };

  const handleLeave = async () => {
    if (!window.confirm('Leave this organization? You will lose access to all cases in this org unless you are also a case member.')) return;
    try {
      await apiClient.leaveOrg(orgSlug);
      router.replace('/');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to leave organization');
    }
  };

  return (
    <SectionCard title="Members">
      {error && <Banner message={error} onClose={() => setError(null)} />}
      {loading ? (
        <Loader inline />
      ) : members.length === 0 ? (
        <p className="text-sm text-ink-muted">No members.</p>
      ) : (
        <div className="overflow-hidden rounded border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface/60 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2">Member</th>
                <th className="px-4 py-2">Role</th>
                <th className="w-16 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.userId === currentUserId;
                return (
                  <tr key={m.id} className="border-t border-line-strong/50">
                    <td className="px-4 py-3">
                      <p className="text-sm text-white">{m.user?.name ?? m.userId}</p>
                      {m.user?.email && (
                        <p className="text-xs text-ink-faint">{m.user.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && !isSelf ? (
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.userId, e.target.value as OrgMemberRole)}
                          className="rounded border border-line-strong bg-surface px-2 py-1 text-xs text-white focus:outline-none focus:border-brand"
                        >
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                          <option value="guest">guest</option>
                        </select>
                      ) : (
                        <RolePill role={m.role} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSelf ? (
                        <button
                          onClick={handleLeave}
                          className="text-xs text-ink-muted hover:text-red-400 transition-colors"
                        >
                          Leave
                        </button>
                      ) : isAdmin ? (
                        <button
                          onClick={() => handleRemove(m.userId, m.user?.email ?? m.userId)}
                          className="p-1.5 text-ink-faint hover:text-red-400"
                          title="Remove member"
                        >
                          <FaTrash size={12} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function InvitesSection({ orgSlug }: { orgSlug: string }) {
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgInviteRole>('member');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listOrgInvites(orgSlug);
      setInvites(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { load(); }, [load]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      await apiClient.createOrgInvite(orgSlug, {
        email: email.trim(),
        role,
        message: message.trim() || undefined,
      });
      setEmail('');
      setMessage('');
      setShowForm(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send invite');
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    if (!window.confirm('Revoke this invite? The invite link will no longer work.')) return;
    try {
      await apiClient.revokeOrgInvite(orgSlug, inviteId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to revoke invite');
    }
  };

  const handleCopy = async (code: string) => {
    const link = `${window.location.origin}/org-invite/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // Clipboard API unavailable — silent fail
    }
  };

  const pendingInvites = invites.filter((i) => !i.usedAt && new Date(i.expiresAt) > new Date());

  return (
    <SectionCard title="Invites (admin only)">
      {error && <Banner message={error} onClose={() => setError(null)} />}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mb-4 flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors"
        >
          <FaPlus size={10} />
          Send invite
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSendInvite} className="mb-6 p-4 rounded border border-line-strong space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as OrgInviteRole)}
                className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
              >
                <option value="member">member</option>
                <option value="guest">guest</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className="w-full bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-brand resize-y"
              placeholder="Optional personal note"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={sending || !email.trim()}
              className="px-3 py-1.5 rounded text-sm bg-brand hover:bg-brand/90 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? 'Sending...' : 'Send invite'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEmail(''); setMessage(''); }}
              className="px-3 py-1.5 rounded text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <Loader inline />
      ) : pendingInvites.length === 0 ? (
        <p className="text-sm text-ink-muted">No pending invites.</p>
      ) : (
        <div className="overflow-hidden rounded border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface/60 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Expires</th>
                <th className="w-24 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.id} className="border-t border-line-strong/50">
                  <td className="px-4 py-3 text-sm text-white">{inv.email}</td>
                  <td className="px-4 py-3">
                    <RolePill role={inv.role as OrgMemberRole} />
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleCopy(inv.code)}
                        className="p-1.5 text-ink-faint hover:text-brand"
                        title="Copy invite link"
                      >
                        {copiedCode === inv.code ? <FaCheck size={12} /> : <FaCopy size={12} />}
                      </button>
                      <button
                        onClick={() => handleRevoke(inv.id)}
                        className="p-1.5 text-ink-faint hover:text-red-400"
                        title="Revoke invite"
                      >
                        <FaTrash size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export default function OrgSettingsPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const { user } = useAuth();
  const orgForThisPage = user?.orgs.find((o) => o.slug === orgSlug);
  const isAdmin = orgForThisPage?.role === 'admin';
  const currentUserId = user?.id ?? '';

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-base font-semibold text-white mb-1">Organization settings</h1>
      <p className="text-sm text-ink-muted mb-8">
        Manage your organization&apos;s profile, members, and invitations.
      </p>

      <OrgInfoSection orgSlug={orgSlug} isAdmin={isAdmin} />
      <MembersSection orgSlug={orgSlug} isAdmin={isAdmin} currentUserId={currentUserId} />
      {isAdmin && <InvitesSection orgSlug={orgSlug} />}
    </div>
  );
}
