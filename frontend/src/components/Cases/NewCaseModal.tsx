'use client';

import { useEffect, useState } from 'react';
import { FaXmark, FaTrash, FaPlus, FaCheck } from 'react-icons/fa6';
import { Modal, IconButton, Button } from '@/components/ui';
import { apiClient, ApiError, type Case } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AddResult =
  | { email: string; role: 'editor' | 'viewer'; status: 'added' }
  | { email: string; role: 'editor' | 'viewer'; status: 'invited'; code: string }
  | { email: string; role: 'editor' | 'viewer'; status: 'error'; reason: string };

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
            {' '}— invite ready
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
        {' '}— {result.reason}
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
  const [phase, setPhase] = useState<'form' | 'summary'>('form');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [members, setMembers] = useState<{ email: string; role: 'editor' | 'viewer' }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCase, setCreatedCase] = useState<Case | null>(null);
  const [results, setResults] = useState<AddResult[]>([]);

  const resetForm = () => {
    setName('');
    setSummary('');
    setMembers([]);
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
    setMembers((prev) => [...prev, { email: '', role: 'viewer' }]);
  };

  const removeMemberRow = (idx: number) => {
    setMembers((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateMemberEmail = (idx: number, email: string) => {
    setMembers((prev) => prev.map((m, i) => i === idx ? { ...m, email } : m));
  };

  const updateMemberRole = (idx: number, role: 'editor' | 'viewer') => {
    setMembers((prev) => prev.map((m, i) => i === idx ? { ...m, role } : m));
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

          {/* Members */}
          <div>
            <label className="block text-sm text-ink-muted mb-1.5">Add members</label>
            {members.length > 0 && (
              <div className="space-y-2 mb-2">
                {members.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="email"
                      placeholder="Email address"
                      value={m.email}
                      onChange={(e) => updateMemberEmail(idx, e.target.value)}
                      className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    />
                    <select
                      value={m.role}
                      onChange={(e) => updateMemberRole(idx, e.target.value as 'editor' | 'viewer')}
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
              Add member
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // Summary phase
  return (
    <Modal
      open
      title="Case created"
      onClose={() => { onCreated?.(createdCase!, results); handleClose(); }}
      maxWidth="max-w-md"
      footer={
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={() => { onCreated?.(createdCase!, results); handleClose(); }}
          >
            Go to case
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
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
