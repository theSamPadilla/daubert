'use client';

import { useEffect, useState } from 'react';
import { FaXmark, FaTrash, FaPlus, FaCheck } from 'react-icons/fa6';
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
        <FaCheck size={12} className="text-emerald-400 flex-shrink-0" />
        <span>
          <span className="text-white">{result.email}</span>
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
          <FaCheck size={12} className="text-emerald-400 flex-shrink-0" />
          <span className="flex-1">
            <span className="text-white">{result.email}</span>
            {' '}— invite ready
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs text-ink-muted hover:text-white transition-colors flex-shrink-0"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {copyFailed && (
          <input
            type="text"
            readOnly
            value={link}
            className="text-xs bg-surface border border-line-strong rounded px-2 py-1 text-ink-muted select-all w-full"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </div>
    );
  }

  // error
  return (
    <div className="flex items-center gap-2 text-sm text-red-400">
      <FaXmark size={12} className="flex-shrink-0" />
      <span>
        <span className="text-red-300">{result.email}</span>
        {' '}— {result.reason}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function NewCaseModal({ open, onClose, onCreated }: NewCaseModalProps) {
  const [phase, setPhase] = useState<'form' | 'summary'>('form');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [members, setMembers] = useState<{ email: string; role: 'editor' | 'viewer' }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCase, setCreatedCase] = useState<Case | null>(null);
  const [results, setResults] = useState<AddResult[]>([]);

  const resetForm = () => {
    setName('');
    setStartDate('');
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

  // Esc to close — disabled in summary phase
  useEffect(() => {
    if (!open || phase === 'summary') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (phase === 'summary') return;
    if (e.target === e.currentTarget) handleClose();
  };

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
        startDate: startDate || undefined,
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

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onMouseDown={handleOverlayMouseDown}
    >
      <div className="bg-surface-panel border border-line-strong rounded-lg shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-strong">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">New case</h2>
          {phase === 'form' && (
            <button
              type="button"
              onClick={handleClose}
              className="text-ink-muted hover:text-white transition-colors"
              aria-label="Close"
            >
              <FaXmark size={16} />
            </button>
          )}
        </div>

        {phase === 'form' ? (
          <>
            {/* Body — form */}
            <div className="p-5 space-y-3">
              {/* Error banner */}
              {error && (
                <div className="flex items-center gap-3 px-4 py-3 rounded border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
                  <span className="flex-1">{error}</span>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="hover:text-white transition-colors"
                  >
                    <FaXmark size={13} />
                  </button>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-sm text-ink-muted mb-1.5">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !submitting) handleSubmit(); }}
                  placeholder="e.g. FTX Investigation"
                  className="w-full bg-surface border border-line-strong rounded px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand"
                  autoFocus
                />
              </div>

              {/* Start date */}
              <div>
                <label className="block text-sm text-ink-muted mb-1.5">
                  Start date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded border border-line-strong bg-surface px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                />
              </div>

              {/* Members */}
              <div>
                <label className="block text-sm text-ink-muted mb-1.5">
                  Add members
                </label>
                {members.length > 0 && (
                  <div className="space-y-2 mb-2">
                    {members.map((m, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="email"
                          placeholder="Email address"
                          value={m.email}
                          onChange={(e) => updateMemberEmail(idx, e.target.value)}
                          className="flex-1 bg-surface border border-line-strong rounded px-3 py-1.5 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand"
                        />
                        <select
                          value={m.role}
                          onChange={(e) => updateMemberRole(idx, e.target.value as 'editor' | 'viewer')}
                          className="rounded border border-line-strong bg-surface px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand"
                        >
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeMemberRow(idx)}
                          className="text-ink-muted hover:text-red-400 transition-colors flex-shrink-0"
                          aria-label="Remove member"
                        >
                          <FaTrash size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={addMemberRow}
                  className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors"
                >
                  <FaPlus size={10} />
                  Add member
                </button>
              </div>
            </div>

            {/* Footer — form */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line-strong">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className="px-3 py-1.5 rounded text-sm bg-surface-raised hover:bg-surface-raised/80 text-ink-muted disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!name.trim() || submitting}
                className="px-3 py-1.5 rounded text-sm bg-brand hover:bg-brand/90 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Creating...' : 'Create case'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Body — summary */}
            <div className="p-5 space-y-3">
              <p className="text-sm text-ink-muted">
                Case <span className="text-white font-medium">{createdCase?.name}</span> created.
              </p>
              {results.length > 0 && (
                <div className="space-y-2">
                  {results.map((r, i) => (
                    <ResultRow key={i} result={r} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer — summary */}
            <div className="flex items-center justify-end px-5 py-4 border-t border-line-strong">
              <button
                type="button"
                onClick={() => {
                  onCreated?.(createdCase!, results);
                  handleClose();
                }}
                className="px-3 py-1.5 rounded text-sm bg-brand hover:bg-brand/90 text-white transition-colors"
              >
                Go to case
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
