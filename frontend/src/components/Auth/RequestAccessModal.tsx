'use client';

import { useEffect, useRef, useState } from 'react';
import { submitAccessRequest, isValidEmail, type AccessRequestPayload } from '@/lib/requestAccess';

interface RequestAccessModalProps {
  defaultEmail?: string;
  source: AccessRequestPayload['source'];
  onClose: () => void;
}

type Phase = 'form' | 'submitting' | 'done';

export function RequestAccessModal({ defaultEmail = '', source, onClose }: RequestAccessModalProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the first empty field. If email is pre-filled, jump to name.
    if (defaultEmail && firstFieldRef.current) {
      const nameInput = firstFieldRef.current.parentElement?.parentElement?.querySelector<HTMLInputElement>(
        'input[name="name"]',
      );
      nameInput?.focus();
    } else {
      firstFieldRef.current?.focus();
    }
  }, [defaultEmail]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'submitting') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, phase]);

  const canSubmit = isValidEmail(email) && phase === 'form';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPhase('submitting');
    setError(null);
    const result = await submitAccessRequest({
      email: email.trim(),
      name: name.trim() || undefined,
      organization: organization.trim() || undefined,
      source,
      origin: 'app',
    });
    if (result.ok) {
      setPhase('done');
    } else {
      setError(result.error);
      setPhase('form');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-surface-panel rounded-lg p-6 w-full max-w-md border border-line-strong shadow-xl">
        {phase === 'done' ? (
          <div className="text-center py-4">
            <h3 className="text-base font-semibold text-ink">Request received</h3>
            <p className="mt-2 text-sm text-ink-muted leading-relaxed">
              Thanks &mdash; we&rsquo;ll reach out to{' '}
              <span className="text-ink">{email}</span> shortly.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 px-4 py-2 bg-brand hover:bg-brand/90 rounded text-sm text-white transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-ink">Request access</h3>
              <p className="mt-1 text-sm text-ink-muted leading-relaxed">
                Tell us a bit about you and we&rsquo;ll get back to you.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="ra-email" className="block text-xs font-medium text-ink-muted mb-1">
                  Email
                </label>
                <input
                  ref={firstFieldRef}
                  id="ra-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={phase === 'submitting'}
                  required
                  className="w-full px-3 py-2 bg-surface border border-line-strong rounded text-sm text-white placeholder-ink-faint focus:outline-none focus:border-brand transition-colors disabled:opacity-50"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="ra-name" className="block text-xs font-medium text-ink-muted mb-1">
                  Name <span className="text-ink-faint">(optional)</span>
                </label>
                <input
                  id="ra-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={phase === 'submitting'}
                  className="w-full px-3 py-2 bg-surface border border-line-strong rounded text-sm text-white placeholder-ink-faint focus:outline-none focus:border-brand transition-colors disabled:opacity-50"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label htmlFor="ra-org" className="block text-xs font-medium text-ink-muted mb-1">
                  Organization <span className="text-ink-faint">(optional)</span>
                </label>
                <input
                  id="ra-org"
                  name="organization"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  disabled={phase === 'submitting'}
                  className="w-full px-3 py-2 bg-surface border border-line-strong rounded text-sm text-white placeholder-ink-faint focus:outline-none focus:border-brand transition-colors disabled:opacity-50"
                  placeholder="Firm or company"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/60 rounded p-3">
                <p className="text-red-300 text-xs leading-relaxed">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex-1 px-4 py-2 bg-brand hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white font-medium transition-colors"
              >
                {phase === 'submitting' ? 'Sending…' : 'Send request'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={phase === 'submitting'}
                className="px-4 py-2 bg-surface-raised hover:bg-surface-raised disabled:opacity-50 rounded text-sm text-ink transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
