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
import { Panel } from '@/components/ui/Panel';
import { Kicker } from '@/components/ui/Kicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { OrgCasesAdminSection } from './OrgCasesAdminSection';

type OrgMember = components['schemas']['OrganizationMember'];
type OrgInvite = components['schemas']['OrganizationInvite'];
type OrgInviteRole = components['schemas']['OrgInviteRole'];

function Banner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 mb-6 rounded-lg border border-redline/30 bg-redline/5 text-redline text-sm">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="hover:text-redline/70 transition-colors">
        <FaXmark size={14} />
      </button>
    </div>
  );
}

function roleBadgeTone(role: OrgMemberRole): 'brand' | 'neutral' | 'accent' {
  if (role === 'admin') return 'brand';
  if (role === 'member') return 'accent';
  return 'neutral';
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
    <Panel padded className="mb-6">
      <Kicker index={1} className="block mb-3">Organization info</Kicker>
      {error && <Banner message={error} onClose={() => setError(null)} />}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm text-ink-muted mb-1">Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
          />
        </div>
        <div>
          <label className="block text-sm text-ink-muted mb-1">Slug</label>
          <Input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!isAdmin}
            className="font-mono"
          />
          {isAdmin && (
            <p className="mt-1 text-xs text-ink-faint">
              Changing the slug will update the URL and break any existing links.
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              disabled={saving || !name.trim() || !slug.trim()}
            >
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
            </Button>
          </div>
        )}
      </form>
    </Panel>
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
      message: <>Remove <span className="text-ink font-medium">{email}</span> from this organization?</>,
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
    <Panel padded className="mb-6">
      <Kicker index={2} className="block mb-3">Members</Kicker>
      {error && <Banner message={error} onClose={() => setError(null)} />}
      <div className="mb-4 rounded-lg border-l-2 border-brand/40 bg-brand-soft px-4 py-3 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-brand font-semibold">
          Who sees what
        </p>
        <p className="text-sm text-ink-muted leading-relaxed">
          <span className="text-ink font-medium">Admins</span> are implicit owners on every case.{' '}
          <span className="text-ink font-medium">Members</span> join every case as editors by default.{' '}
          <span className="text-ink font-medium">Guests</span> can browse every case but need an
          explicit case invite to open one.
        </p>
      </div>
      {loading ? (
        <Loader inline />
      ) : members.length === 0 ? (
        <p className="text-sm text-ink-muted">No members.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-raised text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="w-16 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isSelf = m.userId === currentUserId;
                return (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-4 py-3">
                      <p className="text-sm text-ink">{m.user?.name ?? m.userId}</p>
                      {m.user?.email && (
                        <p className="text-[13px] text-ink-muted">{m.user.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && !isSelf ? (
                        <div className="w-32">
                          <Select
                            value={m.role}
                            onChange={(e) => handleRoleChange(m.userId, e.target.value as OrgMemberRole)}
                            className="text-xs py-1 px-2"
                          >
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                            <option value="guest">guest</option>
                          </Select>
                        </div>
                      ) : (
                        <Badge tone={roleBadgeTone(m.role)}>{m.role}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSelf ? (
                        <button
                          onClick={handleLeave}
                          className="text-xs text-ink-muted hover:text-redline transition-colors"
                        >
                          Leave
                        </button>
                      ) : isAdmin ? (
                        <button
                          onClick={() => handleRemove(m.userId, m.user?.email ?? m.userId)}
                          className="p-1.5 text-ink-faint hover:text-redline transition-colors"
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
    </Panel>
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
    <div className="rounded-lg border-l-2 border-brand/40 bg-brand-soft px-4 py-3 space-y-1">
      <p className="text-[10px] uppercase tracking-[0.18em] text-brand font-semibold">
        {role} can do
      </p>
      <p className="text-sm text-ink font-medium">{blurb.headline}</p>
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
    <Panel padded className="mb-6">
      <Kicker index={3} className="block mb-3">Invites (admin only)</Kicker>
      {error && <Banner message={error} onClose={() => setError(null)} />}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
        >
          <FaPlus size={10} />
          Generate invite
        </button>
      )}

      {showForm && (
        <form
          onSubmit={handleGenerateInvite}
          className="mb-6 p-4 rounded-xl border border-line bg-surface-raised space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Role</label>
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value as OrgInviteRole)}
              >
                <option value="admin">admin</option>
                <option value="member">member</option>
                <option value="guest">guest</option>
              </Select>
            </div>
          </div>
          <RoleExplainer role={role} />
          <div>
            <label className="block text-xs text-ink-muted mb-1">Name (optional)</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
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
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 resize-y"
              placeholder="Optional personal note"
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={sending || !email.trim()}>
              {sending ? 'Generating…' : 'Generate invite'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setShowForm(false); setEmail(''); setName(''); setMessage(''); }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {loading ? (
        <Loader inline />
      ) : pendingInvites.length === 0 ? (
        <p className="text-sm text-ink-muted">No pending invites.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-raised text-left text-xs text-ink-faint uppercase tracking-wider">
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Expires</th>
                <th className="w-24 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {pendingInvites.map((inv) => (
                <tr key={inv.id} className="border-t border-line">
                  <td className="px-4 py-3 text-sm text-ink">{inv.email}</td>
                  <td className="px-4 py-3">
                    <Badge tone={roleBadgeTone(inv.role as OrgMemberRole)}>{inv.role}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleCopy(inv.code)}
                        className="p-1.5 text-ink-faint hover:text-brand transition-colors"
                        title="Copy invite link"
                      >
                        {copiedCode === inv.code ? <FaCheck size={12} /> : <FaCopy size={12} />}
                      </button>
                      <button
                        onClick={() => handleRevoke(inv.id)}
                        className="p-1.5 text-ink-faint hover:text-redline transition-colors"
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
    </Panel>
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
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors mb-8"
      >
        <FaArrowLeft size={10} />
        Back to cases
      </Link>

      <div className="mb-10">
        <Kicker className="block mb-3">Organization</Kicker>
        <h2 className="mt-1 text-3xl font-bold tracking-tight text-ink">
          Settings
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          Manage {orgName ? <span className="text-ink font-medium">{orgName}</span> : 'your organization'}
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
