'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaXmark, FaTrash, FaPlus, FaCopy, FaCheck, FaArrowLeft } from 'react-icons/fa6';
import { useOrgContext } from '@/contexts/OrgContext';
import { useAuth } from '@/components/Auth/AuthProvider';
import { apiClient, type OrgMemberRole } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { InviteCreatedModal } from '@/components/Common/InviteCreatedModal';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { OrgCasesAdminSection } from './OrgCasesAdminSection';

type OrgMember = components['schemas']['OrganizationMember'];
type OrgInvite = components['schemas']['OrganizationInvite'];
type OrgInviteRole = components['schemas']['OrgInviteRole'];

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand disabled:opacity-60 transition-colors';

const primaryBtn =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand hover:bg-brand/90 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const secondaryBtn =
  'px-4 py-2 rounded-lg text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted hover:text-white transition-colors';

function Banner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 mb-6 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="hover:text-white transition-colors">
        <FaXmark size={14} />
      </button>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative mb-6 p-6 rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] overflow-hidden">
      {/* subtle top inner-highlight to give the card a raised edge */}
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <h2 className="text-base font-semibold text-white mb-4">{title}</h2>
      {children}
    </div>
  );
}

function RolePill({ role }: { role: OrgMemberRole }) {
  const colors: Record<OrgMemberRole, string> = {
    admin: 'bg-brand text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]',
    member: 'bg-emerald-900/40 text-emerald-300 border border-emerald-500/30',
    guest: 'bg-surface text-ink-muted border border-line-strong',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold ${colors[role]}`}
    >
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
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm text-ink-muted mb-1">Slug</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!isAdmin}
            className={`${inputClass} font-mono`}
          />
          {isAdmin && (
            <p className="mt-1 text-xs text-ink-faint">
              Changing the slug will update the URL and break any existing links.
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving || !name.trim() || !slug.trim()}
              className={primaryBtn}
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
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: 'Remove member?',
      message: <>Remove <span className="text-white">{email}</span> from this organization?</>,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.removeOrgMember(orgSlug, userId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    }
  };

  const handleLeave = async () => {
    const ok = await confirm({
      title: 'Leave this organization?',
      message:
        'You will lose access to all cases in this org unless you are also a case member.',
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
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
      <div className="mb-4 rounded-lg border-l-2 border-brand-ink/40 bg-brand/10 px-4 py-3 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-brand-ink font-semibold">
          Who sees what
        </p>
        <p className="text-sm text-ink-muted leading-relaxed">
          <span className="text-white font-medium">Admins</span> are implicit owners on every case.{' '}
          <span className="text-white font-medium">Members</span> join every case as editors by default.{' '}
          <span className="text-white font-medium">Guests</span> can browse every case but need an
          explicit case invite to open one.
        </p>
      </div>
      {loading ? (
        <Loader inline />
      ) : members.length === 0 ? (
        <p className="text-sm text-ink-muted">No members.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface/60 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="w-16 px-4 py-2.5"></th>
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
                          className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-white focus:outline-none focus:border-brand"
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

const ROLE_BLURBS: Record<OrgInviteRole, { headline: string; can: string; cant: string }> = {
  admin: {
    headline: 'Full org control.',
    can: 'Implicit owner on every case. Can manage org settings, members, and invites.',
    cant: 'Treat with care — admins can remove other admins and rename the org.',
  },
  member: {
    headline: 'Belongs to every case by default.',
    can: 'Joins every case in the org as an editor automatically. Can create new cases.',
    cant: 'Cannot manage org settings, members, or invites. Admins can override their role on a specific case.',
  },
  guest: {
    headline: 'Browse-only by default.',
    can: 'Can see every case in the org listed on the home page.',
    cant: 'Cannot open a case until an admin or owner explicitly adds them as a case member.',
  },
};

function RoleExplainer({ role }: { role: OrgInviteRole }) {
  const blurb = ROLE_BLURBS[role];
  return (
    <div className="rounded-lg border-l-2 border-brand-ink/40 bg-brand/10 px-4 py-3 space-y-1">
      <p className="text-[10px] uppercase tracking-[0.18em] text-brand-ink font-semibold">
        {role} can do
      </p>
      <p className="text-sm text-white font-medium">{blurb.headline}</p>
      <p className="text-sm text-ink-muted leading-relaxed">{blurb.can}</p>
      <p className="text-xs text-ink-faint leading-relaxed">{blurb.cant}</p>
    </div>
  );
}

function InvitesSection({ orgSlug }: { orgSlug: string }) {
  const confirm = useConfirm();
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<OrgInviteRole>('member');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<OrgInvite | null>(null);

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

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      const inv = await apiClient.createOrgInvite(orgSlug, {
        email: email.trim(),
        role,
        name: name.trim() || undefined,
        message: message.trim() || undefined,
      });
      setEmail('');
      setName('');
      setMessage('');
      setShowForm(false);
      await load();
      setCreatedInvite(inv);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate invite');
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    const ok = await confirm({
      title: 'Revoke this invite?',
      message: 'The invite link will no longer work. The recipient will need a new invite.',
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!ok) return;
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
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors"
        >
          <FaPlus size={10} />
          Generate invite
        </button>
      )}

      {showForm && (
        <form
          onSubmit={handleGenerateInvite}
          className="mb-6 p-4 rounded-xl border border-line-strong/60 bg-surface/40 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as OrgInviteRole)}
                className={inputClass}
              >
                <option value="admin">admin</option>
                <option value="member">member</option>
                <option value="guest">guest</option>
              </select>
            </div>
          </div>
          <RoleExplainer role={role} />
          <div>
            <label className="block text-xs text-ink-muted mb-1">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className={inputClass}
              placeholder="Jane Doe"
            />
            <p className="mt-1 text-xs text-ink-faint">
              Used as the placeholder name in the member list until they sign in and update it.
            </p>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              className={`${inputClass} resize-y`}
              placeholder="Optional personal note"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={sending || !email.trim()} className={primaryBtn}>
              {sending ? 'Generating…' : 'Generate invite'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEmail(''); setName(''); setMessage(''); }}
              className={secondaryBtn}
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
        <div className="overflow-hidden rounded-lg border border-line-strong">
          <table className="w-full">
            <thead>
              <tr className="bg-surface/60 text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Expires</th>
                <th className="w-24 px-4 py-2.5"></th>
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
                        className="p-1.5 text-ink-faint hover:text-brand-ink"
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

      {createdInvite && (
        <InviteCreatedModal
          email={createdInvite.email}
          link={`${window.location.origin}/org-invite/${createdInvite.code}`}
          onClose={() => setCreatedInvite(null)}
        />
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
  const orgId = orgForThisPage?.id;
  const orgName = orgForThisPage?.name;

  return (
    <main className="relative max-w-3xl mx-auto px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors mb-8"
      >
        <FaArrowLeft size={10} />
        Back to cases
      </Link>

      <div className="mb-10">
        <div className="flex items-center gap-3">
          <span className="h-px w-8 bg-gradient-to-r from-brand-ink to-transparent" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
            Organization
          </span>
        </div>
        <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">
          Settings
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Manage {orgName ? <span className="text-white font-medium">{orgName}</span> : 'your organization'}
          &apos;s profile, members, and invitations.
        </p>
      </div>

      <OrgInfoSection orgSlug={orgSlug} isAdmin={isAdmin} />
      <MembersSection orgSlug={orgSlug} isAdmin={isAdmin} currentUserId={currentUserId} />
      {isAdmin && <InvitesSection orgSlug={orgSlug} />}
      {isAdmin && orgId && <OrgCasesAdminSection orgId={orgId} />}
    </main>
  );
}
