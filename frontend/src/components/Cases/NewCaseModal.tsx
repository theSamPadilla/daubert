'use client';

import { useEffect, useState } from 'react';
import { FaXmark, FaTrash, FaPlus, FaCheck } from 'react-icons/fa6';
import { Modal, IconButton, Button } from '@/components/ui';
import { apiClient, ApiError, type Case } from '@/lib/api-client';
import { useAuth } from '@/components/Auth/AuthProvider';
import type { components } from '@/generated/api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrganizationMember = components['schemas']['OrganizationMember'];

type MemberRole = 'editor' | 'viewer';

/** A person staged for the case, either picked from the org roster
 *  (`fromOrg`, identity fixed) or typed in as an external email. */
type StagedMember = {
  email: string;
  name?: string;
  role: MemberRole;
  fromOrg: boolean;
};

export type AddResult =
  | { email: string; role: MemberRole; status: 'added' }
  | { email: string; role: MemberRole; status: 'invited'; code: string }
  | { email: string; role: MemberRole; status: 'error'; reason: string };

interface NewCaseModalProps {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onCreated?: (created: Case, results: AddResult[]) => void;
}

// ---------------------------------------------------------------------------
// ResultRow (summary phase)
// ---------------------------------------------------------------------------

function ResultRow({ result }: { result: AddResult }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  if (result.status === 'added') {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <FaCheck size={12} className="text-emerald-500 flex-shrink-0" />
        <span>
          <span className="text-ink font-medium">{result.email}</span>
          {' '}added as {result.role}
        </span>
      </div>
    );
  }

  if (result.status === 'invited') {
    const link = `${window.location.origin}/invite/${result.code}`;
    const handleCopy = async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setCopyFailed(true);
      }
    };
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <FaCheck size={12} className="text-emerald-500 flex-shrink-0" />
          <span className="flex-1">
            <span className="text-ink font-medium">{result.email}</span>
            {': invite ready'}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-ink-muted hover:text-ink transition-colors flex-shrink-0"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {copyFailed && (
          <input
            type="text"
            readOnly
            value={link}
            className="text-xs bg-surface border border-line-strong rounded-lg px-2 py-1 text-ink-muted select-all w-full"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </div>
    );
  }

  // error
  return (
    <div className="flex items-center gap-2 text-sm text-redline">
      <FaXmark size={12} className="flex-shrink-0" />
      <span>
        <span className="font-medium">{result.email}</span>
        {': '}{result.reason}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

const fieldClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40';

export function NewCaseModal({ open, orgId, onClose, onCreated }: NewCaseModalProps) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<'form' | 'summary'>('form');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [members, setMembers] = useState<StagedMember[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCase, setCreatedCase] = useState<Case | null>(null);
  const [results, setResults] = useState<AddResult[]>([]);

  // Org roster for the "add from your organization" picker.
  const orgSlug = user?.orgs.find((o) => o.id === orgId)?.slug ?? null;
  const [orgMembers, setOrgMembers] = useState<OrganizationMember[] | null>(null);
  const [pickedEmail, setPickedEmail] = useState('');

  useEffect(() => {
    if (!open || !orgSlug) return;
    let cancelled = false;
    apiClient
      .listOrgMembers(orgSlug)
      .then((data) => { if (!cancelled) setOrgMembers(data); })
      .catch(() => { if (!cancelled) setOrgMembers([]); });
    return () => { cancelled = true; };
  }, [open, orgSlug]);

  const resetForm = () => {
    setName('');
    setSummary('');
    setMembers([]);
    setPickedEmail('');
    setCreatedCase(null);
    setResults([]);
    setPhase('form');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Esc to close — disabled in summary phase (Modal handles Esc; we override it here)
  useEffect(() => {
    if (!open || phase === 'summary') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const addMemberRow = () => {
    setMembers((prev) => [...prev, { email: '', role: 'viewer', fromOrg: false }]);
  };

  const removeMemberRow = (idx: number) => {
    setMembers((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateMemberEmail = (idx: number, email: string) => {
    setMembers((prev) => prev.map((m, i) => i === idx ? { ...m, email } : m));
  };

  const updateMemberRole = (idx: number, role: MemberRole) => {
    setMembers((prev) => prev.map((m, i) => i === idx ? { ...m, role } : m));
  };

  // Org admins already get implicit owner access on every case in the org, so
  // staging them here would be a no-op at best (and an explicit case_members
  // row takes precedence over the implicit role, so it can even downgrade
  // them). Leave them out and say why.
  const staged = new Set(members.map((m) => m.email.trim().toLowerCase()));
  const orgAdmins = (orgMembers ?? []).filter(
    (m) => m.role === 'admin' && m.userId !== user?.id,
  );
  const orgCandidates = (orgMembers ?? []).filter(
    (m) =>
      m.role !== 'admin' &&
      !!m.user?.email &&
      m.userId !== user?.id &&
      !staged.has(m.user.email.toLowerCase()),
  );

  const addFromOrg = () => {
    const picked = orgCandidates.find((m) => m.user?.email === pickedEmail);
    if (!picked?.user?.email) return;
    setMembers((prev) => [
      ...prev,
      {
        email: picked.user!.email,
        name: picked.user!.name || undefined,
        role: 'viewer',
        fromOrg: true,
      },
    ]);
    setPickedEmail('');
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setError(null);

      const created = await apiClient.createCase({
        name: name.trim(),
        orgId,
        summary: summary.trim() || undefined,
      });

      const valid = members.filter((m) => m.email.trim().includes('@'));
      const collected: AddResult[] = [];
      for (const m of valid) {
        const email = m.email.trim().toLowerCase();
        try {
          await apiClient.addCaseMember(created.id, { email, role: m.role });
          collected.push({ email, role: m.role, status: 'added' });
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            try {
              const inv = await apiClient.createInvite(created.id, { email, role: m.role });
              collected.push({ email, role: m.role, status: 'invited', code: inv.code });
            } catch (inviteErr) {
              const reason = inviteErr instanceof Error ? inviteErr.message : 'Failed to invite';
              collected.push({ email, role: m.role, status: 'error', reason });
            }
          } else {
            const reason = err instanceof Error ? err.message : String(err);
            collected.push({ email, role: m.role, status: 'error', reason });
          }
        }
      }

      setCreatedCase(created);
      setResults(collected);

      if (collected.length === 0) {
        onCreated?.(created, []);
        handleClose();
      } else {
        setPhase('summary');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create case');
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === 'form') {
    return (
      <Modal
        open
        title="New case"
        onClose={handleClose}
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!name.trim() || !orgId || submitting}
            >
              {submitting ? 'Creating...' : 'Create case'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-redline/40 bg-redline/10 text-redline text-sm">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="hover:text-redline/70 transition-colors"
              >
                <FaXmark size={13} />
              </button>
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm text-ink-muted mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !submitting) handleSubmit(); }}
              placeholder="e.g. FTX Investigation"
              className={fieldClass}
              autoFocus
            />
          </div>

          {/* Summary */}
          <div>
            <label className="block text-sm text-ink-muted mb-1.5">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder="What's this case about? Parties, allegations, timeline."
              className={`${fieldClass} resize-y`}
            />
          </div>

          {/* Add from your organization — colleagues who already have accounts */}
          {orgSlug && (
            <div>
              <label className="block text-sm text-ink-muted mb-1.5">
                Add from your organization
              </label>
              {orgMembers === null ? (
                <p className="text-xs text-ink-faint">Loading…</p>
              ) : orgCandidates.length === 0 && orgAdmins.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  {(orgMembers?.length ?? 0) <= 1
                    ? 'No one else in your organization yet.'
                    : 'Everyone available has already been added below.'}
                </p>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={pickedEmail}
                    onChange={(e) => setPickedEmail(e.target.value)}
                    className="flex-1 min-w-0 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    <option value="">Select a colleague…</option>
                    {orgCandidates.map((m) => (
                      <option key={m.userId} value={m.user!.email}>
                        {m.user?.name ? `${m.user.name} (${m.user!.email})` : m.user!.email}
                      </option>
                    ))}
                    {/* Shown but unselectable: org admins get access to every
                        case in the org automatically. */}
                    {orgAdmins.map((m) => (
                      <option key={m.userId} value="" disabled>
                        {m.user?.name || m.user?.email || m.userId} — org admin, already has access
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={addFromOrg}
                    disabled={!pickedEmail}
                  >
                    Add
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Staged people (org picks + external emails) */}
          <div>
            <label className="block text-sm text-ink-muted mb-1.5">
              {members.length > 0 ? 'People on this case' : 'Add members'}
            </label>
            {members.length > 0 && (
              <div className="space-y-2 mb-2">
                {members.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    {m.fromOrg ? (
                      <div className="flex-1 min-w-0 rounded-lg border border-line bg-surface-raised px-3 py-1.5">
                        <p className="text-sm text-ink truncate">{m.name || m.email}</p>
                        {m.name && (
                          <p className="text-[11px] text-ink-faint truncate">{m.email}</p>
                        )}
                      </div>
                    ) : (
                      <input
                        type="email"
                        placeholder="Email address"
                        value={m.email}
                        onChange={(e) => updateMemberEmail(idx, e.target.value)}
                        className="flex-1 min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      />
                    )}
                    <select
                      value={m.role}
                      onChange={(e) => updateMemberRole(idx, e.target.value as MemberRole)}
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <IconButton
                      aria-label="Remove member"
                      onClick={() => removeMemberRow(idx)}
                      className="text-ink-muted hover:text-redline"
                    >
                      <FaTrash size={12} />
                    </IconButton>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={addMemberRow}
              className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
            >
              <FaPlus size={10} />
              Invite someone outside your organization
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // Summary phase — Esc and overlay-click are intentionally no-ops; user must click "Go to case".
  // No title prop so Modal renders no header bar (and therefore no X button), matching the
  // pre-aad2631 layout where summary had a header with no close button.
  const goToCase = () => { onCreated?.(createdCase!, results); handleClose(); };
  return (
    <Modal
      open
      onClose={() => {}}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={goToCase}>
            Go to case
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between pb-4 border-b border-line mb-1">
          <span className="text-[15px] font-medium text-ink">New case</span>
        </div>
        <p className="text-sm text-ink-muted">
          Case <span className="text-ink font-medium">{createdCase?.name}</span> created.
        </p>
        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((r, i) => (
              <ResultRow key={i} result={r} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
