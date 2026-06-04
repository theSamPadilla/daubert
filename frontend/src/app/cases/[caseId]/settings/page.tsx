'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaPlus, FaTrash, FaCopy, FaCheck, FaXmark } from 'react-icons/fa6';
import { useCaseContext } from '@/contexts/CaseContext';
import {
  apiClient,
  type CaseMember,
  type CaseInvite,
  type CaseRole,
} from '@/lib/api-client';
import { InviteCreatedModal } from '@/components/Common/InviteCreatedModal';
import { useConfirm } from '@/components/Common/ConfirmProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Case Info section (owner-only)
// ---------------------------------------------------------------------------

function CaseInfoSection({ caseId }: { caseId: string }) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.getCase(caseId).then((c) => {
      setName(c.name);
      setSummary(c.summary ?? '');
    }).catch((e) => setError(e.message));
  }, [caseId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClient.updateCase(caseId, {
        name,
        summary: summary.trim() ? summary : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Case info">
      {error && <Banner message={error} onClose={() => setError(null)} />}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-ink-muted mb-1">Case name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-ink-muted mb-1">Summary</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            placeholder="What's this case about? Parties, allegations, timeline, anything that helps team members get oriented."
            className="w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium text-white transition-colors"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-400">
              <FaCheck size={12} /> Saved
            </span>
          )}
        </div>
      </form>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Members section (owner + editor)
// ---------------------------------------------------------------------------

function MembersSection({ caseId, viewerRole }: { caseId: string; viewerRole: CaseRole }) {
  const [members, setMembers] = useState<CaseMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // userId being acted on

  const load = useCallback(() => {
    apiClient.listCaseMembers(caseId).then(setMembers).catch((e) => setError(e.message));
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const ownerCount = members.filter((m) => m.role === 'owner').length;

  const isLastOwner = (m: CaseMember) => m.role === 'owner' && ownerCount === 1;

  const handleRoleChange = async (userId: string, role: CaseRole) => {
    setBusy(userId);
    setError(null);
    try {
      await apiClient.updateCaseMemberRole(caseId, userId, role);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (userId: string) => {
    setBusy(userId);
    setError(null);
    try {
      await apiClient.removeCaseMember(caseId, userId);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    } finally {
      setBusy(null);
    }
  };

  const roleLabel = (r: CaseRole) => r.charAt(0).toUpperCase() + r.slice(1);

  return (
    <SectionCard title="Members">
      {error && <Banner message={error} onClose={() => setError(null)} />}
      <div className="mb-4 rounded-md border-l-2 border-brand-ink/40 bg-brand/10 px-4 py-3 space-y-1">
        <p className="text-[10px] uppercase tracking-wider text-brand-ink font-semibold">
          Who sees this case
        </p>
        <p className="text-sm text-ink-muted leading-relaxed">
          Only the people listed below — plus any{' '}
          <span className="text-white font-medium">org admins</span> of the org this case belongs
          to, who have implicit owner access on every case in their org.
        </p>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-ink-muted">No members found.</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const canAct = viewerRole === 'owner' && !isLastOwner(m);
            const isBusy = busy === m.userId;
            return (
              <div
                key={m.userId}
                className="flex items-center gap-3 px-3 py-2.5 rounded border border-line-strong bg-surface"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">
                    {m.user?.name ?? m.user?.email ?? m.userId}
                  </p>
                  {m.user?.email && (
                    <p className="text-xs text-ink-muted truncate">{m.user.email}</p>
                  )}
                </div>
                {viewerRole === 'owner' ? (
                  <div
                    title={isLastOwner(m) ? 'Cannot change — last owner' : undefined}
                  >
                    <select
                      value={m.role}
                      disabled={isBusy || isLastOwner(m)}
                      onChange={(e) => handleRoleChange(m.userId, e.target.value as CaseRole)}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <option value="owner">Owner</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                ) : (
                  <span className="text-xs text-ink-muted">{roleLabel(m.role)}</span>
                )}
                {viewerRole === 'owner' && (
                  <div title={isLastOwner(m) ? 'Cannot remove — last owner' : 'Remove member'}>
                    <button
                      disabled={isBusy || isLastOwner(m)}
                      onClick={() => handleRemove(m.userId)}
                      className="text-ink-muted hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <FaTrash size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Invites section (owner-only)
// ---------------------------------------------------------------------------

function InvitesSection({ caseId }: { caseId: string }) {
  const [invites, setInvites] = useState<CaseInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  // Create form state
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'owner' | 'editor' | 'viewer'>('viewer');
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [newInvite, setNewInvite] = useState<CaseInvite | null>(null);

  const load = useCallback(() => {
    apiClient.listInvites(caseId).then((all) =>
      setInvites(all.filter((inv) => !inv.usedAt))
    ).catch((e) => setError(e.message));
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const inviteLink = (code: string) =>
    `${window.location.origin}/invite/${code}`;

  const copyLink = (code: string, id: string) => {
    navigator.clipboard.writeText(inviteLink(code)).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleRevoke = async (inviteId: string) => {
    setRevoking(inviteId);
    setError(null);
    try {
      await apiClient.revokeInvite(caseId, inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      if (newInvite?.id === inviteId) setNewInvite(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to revoke');
    } finally {
      setRevoking(null);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const inv = await apiClient.createInvite(caseId, {
        email,
        role,
        name: name.trim() || undefined,
        message: message || undefined,
      });
      setInvites((prev) => [inv, ...prev]);
      setNewInvite(inv);
      setEmail('');
      setName('');
      setMessage('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate invite');
    } finally {
      setCreating(false);
    }
  };

  return (
    <SectionCard title="Invites">
      {error && <Banner message={error} onClose={() => setError(null)} />}

      {/* New invite form */}
      <form onSubmit={handleGenerate} className="space-y-3 mb-5 pb-5 border-b border-line-strong">
        <p className="text-sm font-medium text-white">Generate invite</p>
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'owner' | 'editor' | 'viewer')}
            className="rounded border border-line-strong bg-surface px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <input
          type="text"
          placeholder="Name (optional) — e.g. Jane Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <textarea
          placeholder="Optional message to invitee"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          className="w-full rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-white placeholder-ink-muted focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
        />
        <button
          type="submit"
          disabled={creating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-brand hover:bg-brand/90 disabled:opacity-50 text-sm font-medium text-white transition-colors"
        >
          <FaPlus size={11} />
          {creating ? 'Generating…' : 'Generate invite'}
        </button>
      </form>

      {/* Post-generation modal */}
      {newInvite && (
        <InviteCreatedModal
          email={newInvite.email}
          link={inviteLink(newInvite.code)}
          onClose={() => setNewInvite(null)}
        />
      )}

      {/* Pending invites list */}
      {invites.length === 0 ? (
        <p className="text-sm text-ink-muted">No pending invites.</p>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-line-strong bg-surface"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{inv.email}</p>
                <p className="text-xs text-ink-muted">
                  {inv.role.charAt(0).toUpperCase() + inv.role.slice(1)} &middot; expires{' '}
                  {new Date(inv.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => copyLink(inv.code, inv.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line-strong bg-surface-panel hover:bg-surface-raised text-brand-ink hover:text-white transition-colors text-xs font-medium"
                title="Copy invite link"
              >
                {copied === inv.id ? (
                  <>
                    <FaCheck size={11} className="text-green-400" />
                    <span className="text-green-400">Copied</span>
                  </>
                ) : (
                  <>
                    <FaCopy size={11} />
                    <span>Copy link</span>
                  </>
                )}
              </button>
              <button
                disabled={revoking === inv.id}
                onClick={() => handleRevoke(inv.id)}
                className="text-ink-muted hover:text-red-400 disabled:opacity-40 transition-colors"
                title="Revoke invite"
              >
                <FaTrash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Leave case section (all non-viewer roles)
// ---------------------------------------------------------------------------

function LeaveCaseSection({
  caseId,
  viewerRole,
  ownerCount,
}: {
  caseId: string;
  viewerRole: CaseRole | null;
  ownerCount: number;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only owners can be the sole owner — editors/viewers can always leave.
  const isOnlyOwner = viewerRole === 'owner' && ownerCount === 1;

  const handleLeave = async () => {
    const ok = await confirm({
      title: 'Leave this case?',
      message: 'You will lose access to this case and all its investigations immediately.',
      confirmLabel: 'Leave case',
      destructive: true,
    });
    if (!ok) return;

    setLeaving(true);
    setError(null);
    try {
      await apiClient.leaveCase(caseId);
      router.push('/');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to leave case');
      setLeaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-red-500/30 bg-surface-panel p-6 mb-6">
      <h2 className="text-base font-semibold text-red-400 mb-1">Leave this case</h2>
      <p className="text-sm text-ink-muted mb-4">
        You will immediately lose access to this case and all its investigations.
      </p>
      {error && <Banner message={error} onClose={() => setError(null)} />}
      <div
        title={
          isOnlyOwner
            ? 'Promote another member to owner before leaving.'
            : undefined
        }
        className="inline-block"
      >
        <button
          onClick={handleLeave}
          disabled={leaving || isOnlyOwner}
          className="px-4 py-2 rounded border border-red-500/50 text-red-400 text-sm font-medium hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {leaving ? 'Leaving...' : 'Leave case'}
        </button>
      </div>
      {isOnlyOwner && (
        <p className="mt-2 text-xs text-ink-muted">
          Promote another member to owner before leaving.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CaseSettingsPage() {
  const { caseId, viewerRole } = useCaseContext();
  const router = useRouter();

  // Redirect viewers — they have no settings to view
  useEffect(() => {
    if (viewerRole === 'viewer') {
      router.replace(`/cases/${caseId}/investigations`);
    }
  }, [viewerRole, caseId, router]);

  const [globalError, setGlobalError] = useState<string | null>(null);
  const [ownerCount, setOwnerCount] = useState(0);

  useEffect(() => {
    if (viewerRole && viewerRole !== 'viewer') {
      apiClient.listCaseMembers(caseId).then((members) => {
        setOwnerCount(members.filter((m) => m.role === 'owner').length);
      }).catch(() => {/* non-critical; leave button falls back to enabled */});
    }
  }, [caseId, viewerRole]);

  if (viewerRole === 'viewer') return null;

  return (
    <div className="min-h-screen bg-surface text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-surface border-b border-line-strong px-6 py-4 flex items-center gap-4">
        <a
          href={`/cases/${caseId}/investigations`}
          className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-white transition-colors"
        >
          <FaArrowLeft size={12} />
          Back
        </a>
        <h1 className="text-base font-semibold text-white">Case settings</h1>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-6 py-8">
        {globalError && <Banner message={globalError} onClose={() => setGlobalError(null)} />}

        {viewerRole === 'owner' && <CaseInfoSection caseId={caseId} />}

        {(viewerRole === 'owner' || viewerRole === 'editor') && (
          <MembersSection caseId={caseId} viewerRole={viewerRole} />
        )}

        {viewerRole === 'owner' && <InvitesSection caseId={caseId} />}

        <LeaveCaseSection caseId={caseId} viewerRole={viewerRole} ownerCount={ownerCount} />
      </div>
    </div>
  );
}
