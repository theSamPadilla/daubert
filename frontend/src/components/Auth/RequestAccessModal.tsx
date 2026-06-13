'use client';

import { useEffect, useRef, useState } from 'react';
import { FaCircleCheck, FaPaperPlane } from 'react-icons/fa6';
import { submitAccessRequest, isValidEmail, type AccessRequestPayload } from '@/lib/requestAccess';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

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

  if (phase === 'done') {
    return (
      <Modal
        open
        onClose={onClose}
      >
        <div className="text-center space-y-4 py-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30">
            <FaCircleCheck className="w-6 h-6 text-emerald-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-semibold text-ink tracking-tight">Request received</h3>
            <p className="text-sm text-ink-muted leading-relaxed max-w-xs mx-auto">
              Thanks &mdash; we&rsquo;ll reach out to{' '}
              <span className="text-ink font-medium">{email}</span> shortly.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="mt-2"
          >
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={phase !== 'submitting' ? onClose : () => {}}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-medium">
            <FaPaperPlane className="w-3 h-3" />
            We&rsquo;ll be in touch
          </div>
          <h3 className="text-xl font-semibold text-ink tracking-tight">Request access</h3>
          <p className="text-sm text-ink-muted leading-relaxed">
            Tell us a bit about you and we&rsquo;ll get back to you.
          </p>
        </div>

        <div className="space-y-3">
          <Field label="Email">
            <Input
              ref={emailRef}
              id="ra-email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={phase === 'submitting'}
              required
              placeholder="you@example.com"
            />
          </Field>

          <Field label="Name (optional)">
            <Input
              ref={nameRef}
              id="ra-name"
              name="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={phase === 'submitting'}
              placeholder="Your name"
            />
          </Field>

          <Field label="Organization (optional)">
            <Input
              id="ra-org"
              name="organization"
              type="text"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              disabled={phase === 'submitting'}
              placeholder="Firm or company"
            />
          </Field>
        </div>

        {error && (
          <div className="bg-redline/10 border border-redline/30 rounded-lg p-3">
            <p className="text-redline text-xs leading-relaxed">{error}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={phase === 'submitting'}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
          >
            {phase === 'submitting' ? (
              'Sending…'
            ) : (
              <>
                <FaPaperPlane className="w-3.5 h-3.5" />
                Send request
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
