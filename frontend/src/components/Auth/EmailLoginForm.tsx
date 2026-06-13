'use client';

import { useState, useEffect } from 'react';
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { apiClient } from '@/lib/api-client';
import { OtpInput } from './OtpInput';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export interface EmailLoginFormProps {
  defaultEmail?: string;
  lockEmail?: boolean;
  onVerified?: () => Promise<void>;
  onBack?: () => void;
  // When set, the email-phase error block renders a "Request access" button if
  // the backend rejected the email as having no account. The callback receives
  // the email the user attempted so the parent can pre-fill the modal.
  onRequestAccess?: (email: string) => void;
}

type State =
  | { phase: 'email' }
  | { phase: 'sending' }
  | { phase: 'code'; email: string }
  | { phase: 'verifying' }
  | { phase: 'error'; message: string; from: 'email' | 'code' };

function waitForFirebaseUser(timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Sign-in took too long. Please try again.'));
    }, timeoutMs);
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export function EmailLoginForm({ defaultEmail = '', lockEmail = false, onVerified, onBack, onRequestAccess }: EmailLoginFormProps) {
  const [state, setState] = useState<State>({ phase: 'email' });
  const [emailInput, setEmailInput] = useState(defaultEmail);
  const [code, setCode] = useState('');

  async function sendOtp(email: string) {
    setState({ phase: 'sending' });
    try {
      await apiClient.sendEmailOtp({ email });
      setState({ phase: 'code', email });
    } catch (err: any) {
      setState({ phase: 'error', message: err?.message || 'Failed to send code. Please try again.', from: 'email' });
    }
  }

  async function verifyOtp(email: string, otpCode: string) {
    setState({ phase: 'verifying' });
    try {
      const response = await apiClient.verifyEmailOtp({ email, code: otpCode });
      await signInWithCustomToken(getFirebaseAuth(), response.token);
      await waitForFirebaseUser();
      if (onVerified) {
        await onVerified();
      }
    } catch (err: any) {
      setCode('');
      setState({ phase: 'error', message: err?.message || 'Invalid or expired code. Please try again.', from: 'code' });
    }
  }

  function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailInput.trim() || state.phase === 'sending') return;
    sendOtp(emailInput.trim());
  }

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && state.phase === 'code') {
      verifyOtp(state.email, code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const isSending = state.phase === 'sending';
  const isVerifying = state.phase === 'verifying';

  // ── Email phase ────────────────────────────────────────────────────────────
  if (state.phase === 'email' || state.phase === 'sending' || (state.phase === 'error' && state.from === 'email')) {
    const errorMessage = state.phase === 'error' ? state.message : null;
    return (
      <div className="w-full space-y-3">
        <form onSubmit={handleEmailSubmit} className="space-y-2">
          <Input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@example.com"
            disabled={isSending || lockEmail}
            autoFocus={!lockEmail}
          />
          <Button
            type="submit"
            disabled={!emailInput.trim() || isSending}
            className="w-full"
          >
            {isSending ? 'Sending code…' : 'Continue'}
          </Button>
        </form>
        {errorMessage && (
          <div className="bg-redline/10 border border-redline/30 rounded-lg p-4 text-center">
            <p className="text-redline text-sm leading-relaxed">{errorMessage}</p>
            {onRequestAccess && /no account found/i.test(errorMessage) && (
              <Button
                type="button"
                onClick={() => onRequestAccess(emailInput.trim())}
                size="sm"
                className="mt-3"
              >
                Request access
              </Button>
            )}
          </div>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-ink-muted hover:text-ink underline block mx-auto transition-colors"
          >
            Back
          </button>
        )}
      </div>
    );
  }

  // ── Code phase ─────────────────────────────────────────────────────────────
  // Resolve email for code/verifying/error-from-code phases
  const resolvedEmail = state.phase === 'code'
    ? state.email
    : emailInput;

  const errorMessage = state.phase === 'error' && state.from === 'code' ? state.message : null;

  return (
    <div className="w-full space-y-5">
      <div className="text-center space-y-1">
        <p className="text-ink font-medium text-base">Check your inbox for a code</p>
        <p className="text-ink-muted text-sm">
          We sent a 6-digit code to <span className="text-ink">{resolvedEmail}</span>
        </p>
      </div>

      <div className="flex justify-center">
        <OtpInput
          value={code}
          onChange={setCode}
          autoFocus
          disabled={isVerifying}
        />
      </div>

      <Button
        type="button"
        onClick={() => verifyOtp(resolvedEmail, code)}
        disabled={code.length < 6 || isVerifying}
        className="w-full"
      >
        {isVerifying ? 'Verifying…' : 'Verify'}
      </Button>

      {errorMessage && (
        <div className="bg-redline/10 border border-redline/30 rounded-lg p-4 text-center">
          <p className="text-redline text-sm leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {!lockEmail && (
        <button
          type="button"
          onClick={() => {
            setCode('');
            setState({ phase: 'email' });
          }}
          className="text-sm text-ink-muted hover:text-ink underline block mx-auto transition-colors"
        >
          Use a different email
        </button>
      )}
    </div>
  );
}
