'use client';

import { useState, useCallback, useEffect } from 'react';
import { FaTrash, FaPlus, FaCopy, FaCheck } from 'react-icons/fa6';
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
import { Banner } from './Banner';
import { roleBadgeTone } from './MembersSection';

type OrgInvite = components['schemas']['OrganizationInvite'];
type OrgInviteRole = components['schemas']['OrgInviteRole'];

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

export function InvitesSection({ orgSlug }: { orgSlug: string }) {
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
