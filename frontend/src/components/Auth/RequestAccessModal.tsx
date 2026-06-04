'use client';

import { useEffect, useRef, useState } from 'react';
import { FaCircleCheck, FaPaperPlane } from 'react-icons/fa6';
import { submitAccessRequest, isValidEmail, type AccessRequestPayload } from '@/lib/requestAccess';

interface RequestAccessModalProps {
  defaultEmail?: string;
  source: AccessRequestPayload['source'];
  onClose: () => void;
}

type Phase = 'form' | 'submitting' | 'done';

const inputClass =
  'w-full px-3.5 py-2.5 bg-surface border border-line-strong rounded-lg text-sm text-white placeholder-ink-faint focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all disabled:opacity-50';

const labelClass = 'block text-xs font-medium text-ink-muted mb-1.5 uppercase tracking-wide';

export function RequestAccessModal({ defaultEmail = '', source, onClose }: RequestAccessModalProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // If email came pre-filled, focus the next empty field; otherwise focus email.
    if (defaultEmail) {
      nameRef.current?.focus();
    } else {
      emailRef.current?.focus();
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
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'submitting') onClose();
      }}
    >
      <div className="relative bg-surface-panel rounded-2xl w-full max-w-md border border-line-strong shadow-2xl p-8">
        {phase === 'done' ? (
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <FaCircleCheck className="w-6 h-6 text-emerald-300" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-semibold text-white tracking-tight">Request received</h3>
              <p className="text-sm text-ink-muted leading-relaxed max-w-xs mx-auto">
                Thanks &mdash; we&rsquo;ll reach out to{' '}
                <span className="text-white font-medium">{email}</span> shortly.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 px-6 py-2 rounded-lg bg-surface-raised hover:bg-surface-raised/80 text-sm font-medium text-ink-muted hover:text-white transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/30 border border-brand-ink/40 text-brand-ink text-xs font-medium">
                <FaPaperPlane className="w-3 h-3" />
                We&rsquo;ll be in touch
              </div>
              <h3 className="text-2xl font-semibold text-white tracking-tight">Request access</h3>
              <p className="text-sm text-ink-muted leading-relaxed">
                Tell us a bit about you and we&rsquo;ll get back to you.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="ra-email" className={labelClass}>
                  Email
                </label>
                <input
                  ref={emailRef}
                  id="ra-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={phase === 'submitting'}
                  required
                  className={inputClass}
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label htmlFor="ra-name" className={labelClass}>
                  Name <span className="text-ink-faint normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  ref={nameRef}
                  id="ra-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={phase === 'submitting'}
                  className={inputClass}
                  placeholder="Your name"
                />
              </div>

              <div>
                <label htmlFor="ra-org" className={labelClass}>
                  Organization <span className="text-ink-faint normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="ra-org"
                  name="organization"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  disabled={phase === 'submitting'}
                  className={inputClass}
                  placeholder="Firm or company"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-700/60 rounded-lg p-3">
                <p className="text-red-300 text-xs leading-relaxed">{error}</p>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={phase === 'submitting'}
                className="px-4 py-2.5 rounded-lg bg-surface-raised hover:bg-surface-raised/80 disabled:opacity-50 text-sm font-medium text-ink-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-brand hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-white font-medium transition-colors shadow-sm shadow-brand/20"
              >
                {phase === 'submitting' ? (
                  'Sending…'
                ) : (
                  <>
                    <FaPaperPlane className="w-3.5 h-3.5" />
                    Send request
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
