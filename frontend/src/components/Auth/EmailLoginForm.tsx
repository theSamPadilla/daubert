'use client';

import { useState, useEffect } from 'react';
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { apiClient } from '@/lib/api-client';
import { OtpInput } from './OtpInput';

export interface EmailLoginFormProps {
  defaultEmail?: string;
  lockEmail?: boolean;
  onVerified?: () => Promise<void>;
  onBack?: () => void;
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

export function EmailLoginForm({ defaultEmail = '', lockEmail = false, onVerified, onBack }: EmailLoginFormProps) {
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
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="you@example.com"
            disabled={isSending || lockEmail}
            autoFocus={!lockEmail}
            className="w-full px-4 py-2.5 bg-surface-panel border border-line-strong rounded-lg text-white placeholder-ink-faint text-sm focus:outline-none focus:border-brand transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!emailInput.trim() || isSending}
            className="w-full flex items-center justify-center px-4 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? 'Sending code…' : 'Continue'}
          </button>
        </form>
        {errorMessage && (
          <div className="bg-red-900/30 border border-red-700/60 rounded-lg p-4 text-center">
            <p className="text-red-300 text-sm leading-relaxed">{errorMessage}</p>
          </div>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-ink-muted hover:text-white underline block mx-auto"
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
        <p className="text-white font-medium text-base">Check your inbox for a code</p>
        <p className="text-ink-muted text-sm">
          We sent a 6-digit code to <span className="text-white">{resolvedEmail}</span>
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

      <button
        type="button"
        onClick={() => verifyOtp(resolvedEmail, code)}
        disabled={code.length < 6 || isVerifying}
        className="w-full flex items-center justify-center px-4 py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isVerifying ? 'Verifying…' : 'Verify'}
      </button>

      {errorMessage && (
        <div className="bg-red-900/30 border border-red-700/60 rounded-lg p-4 text-center">
          <p className="text-red-300 text-sm leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {!lockEmail && (
        <button
          type="button"
          onClick={() => {
            setCode('');
            setState({ phase: 'email' });
          }}
          className="text-sm text-ink-muted hover:text-white underline block mx-auto"
        >
          Use a different email
        </button>
      )}
    </div>
  );
}
