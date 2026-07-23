'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FaTrash } from 'react-icons/fa6';
import { apiClient, type OrgMemberRole } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { Panel } from '@/components/ui/Panel';
import { Kicker } from '@/components/ui/Kicker';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Banner } from './Banner';

type OrgMember = components['schemas']['OrganizationMember'];

export function roleBadgeTone(role: OrgMemberRole): 'brand' | 'neutral' | 'accent' {
  if (role === 'admin') return 'brand';
  if (role === 'member') return 'accent';
  return 'neutral';
}

export function MembersSection({
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
