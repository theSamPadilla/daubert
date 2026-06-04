'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { signInWithPopup, type AuthProvider } from 'firebase/auth';
import { getFirebaseAuth, googleProvider, microsoftProvider } from '@/lib/firebase';
import { useAuth } from '@/components/Auth/AuthProvider';
import { EmailLoginForm } from '@/components/Auth/EmailLoginForm';
import { RequestAccessModal } from '@/components/Auth/RequestAccessModal';

function friendlyAuthError(err: any): string {
  switch (err?.code) {
    case 'auth/account-exists-with-different-credential':
      return 'This email is already linked to a different sign-in method on this account. Try signing in with the method you used originally (Google or Microsoft).';
    case 'auth/popup-blocked':
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/web-storage-unsupported':
    case 'auth/operation-not-supported-in-this-environment':
      return 'This browser is blocking storage that Firebase needs. Try a different browser or allow third-party cookies.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/internal-error':
      return 'Sign-in failed unexpectedly. Try again, or use the other provider.';
    default:
      return err?.message || `Sign-in failed${err?.code ? ` (${err.code})` : ''}`;
  }
}

function HeroLogo() {
  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-[340px] items-center justify-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-6 rounded-full bg-gradient-to-br from-brand/40 via-brand-soft/60 to-transparent blur-3xl"
      />
      <svg
        viewBox="0 0 200 200"
        className="pointer-events-none absolute inset-0 h-full w-full text-brand-ink/30"
        style={{ animation: 'spin-slow 60s linear infinite' }}
        fill="none"
        aria-hidden
      >
        <circle cx="100" cy="100" r="94" stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" />
        <line x1="100" y1="3" x2="100" y2="9" stroke="currentColor" strokeWidth="1.5" />
        <line x1="100" y1="191" x2="100" y2="197" stroke="currentColor" strokeWidth="1.5" />
        <line x1="3" y1="100" x2="9" y2="100" stroke="currentColor" strokeWidth="1.5" />
        <line x1="191" y1="100" x2="197" y2="100" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg
        viewBox="0 0 200 200"
        className="pointer-events-none absolute inset-0 h-full w-full text-accent/30"
        style={{ animation: 'spin-reverse 90s linear infinite' }}
        fill="none"
        aria-hidden
      >
        <circle cx="100" cy="100" r="78" stroke="currentColor" strokeWidth="1" strokeDasharray="1 5" />
      </svg>
      <Image
        src="/logo-light.png"
        alt="Daubert AI"
        width={340}
        height={340}
        priority
        className="relative h-[58%] w-[58%] object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.45)]"
        style={{ animation: 'float 8s ease-in-out infinite' }}
      />
    </div>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#F25022" d="M3 3h8.5v8.5H3V3Z" />
      <path fill="#7FBA00" d="M12.5 3H21v8.5h-8.5V3Z" />
      <path fill="#00A4EF" d="M3 12.5h8.5V21H3v-8.5Z" />
      <path fill="#FFB900" d="M12.5 12.5H21V21h-8.5v-8.5Z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, noAccount, loading, signOut } = useAuth();
  const [signingIn, setSigningIn] = useState<'google' | 'microsoft' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRequestAccess, setShowRequestAccess] = useState<{ source: 'login-email' | 'login-no-account'; email: string } | null>(null);

  useEffect(() => {
    if (user && !loading) {
      router.replace('/');
    }
  }, [user, loading, router, noAccount]);

  async function handleSignIn(provider: AuthProvider, label: 'google' | 'microsoft') {
    setSigningIn(label);
    setError(null);
    try {
      // Popup mode: signInWithRedirect breaks under Chrome's third-party
      // storage partitioning when app and auth domains are cross-site.
      await signInWithPopup(getFirebaseAuth(), provider);
    } catch (err: any) {
      console.error('[login] sign-in', err?.code, err?.message, err);
      setError(friendlyAuthError(err));
      setSigningIn(null);
    }
  }

  const busy = signingIn !== null || loading;

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-surface bg-noise px-4 py-10 overflow-hidden">
      <div className="pointer-events-none absolute -right-40 -bottom-40 -z-10 opacity-[0.05] select-none">
        <Image src="/logo-light.png" alt="" width={720} height={720} priority />
      </div>
      <div className="pointer-events-none absolute -left-40 -top-40 -z-10 opacity-[0.04] select-none">
        <Image src="/logo-light.png" alt="" width={560} height={560} priority />
      </div>

      <div className="relative w-full max-w-lg flex flex-col items-center gap-12">
        <HeroLogo />

        <div className="text-center space-y-4">
          <h1 className="text-6xl font-bold tracking-tight text-white">
            Daubert AI
          </h1>
          <p className="text-ink-muted text-lg max-w-md mx-auto leading-relaxed">
            The agentic workspace for blockchain&rsquo;s most technical cases.
          </p>
        </div>

        <div className="w-full max-w-sm space-y-6">
          {noAccount ? (
            <div className="bg-red-900/30 border border-red-700/60 rounded-lg p-5 text-center">
              <p className="text-red-300 text-base">
                No account found for {getFirebaseAuth().currentUser?.email}.
              </p>
              <button
                type="button"
                onClick={() =>
                  setShowRequestAccess({
                    source: 'login-no-account',
                    email: getFirebaseAuth().currentUser?.email ?? '',
                  })
                }
                className="mt-4 inline-flex items-center justify-center px-4 py-2 bg-brand hover:bg-brand/90 rounded text-sm text-white font-medium transition-colors"
              >
                Request access
              </button>
              <button
                onClick={async () => {
                  await signOut();
                  window.location.reload();
                }}
                className="mt-4 ml-3 text-sm text-ink-muted hover:text-white underline"
              >
                Sign in with a different account
              </button>
            </div>
          ) : (
            <>
              <EmailLoginForm
                onRequestAccess={(email) =>
                  setShowRequestAccess({ source: 'login-email', email })
                }
              />

              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-line-strong" />
                <span className="text-ink-faint text-xs">or continue with</span>
                <div className="h-px flex-1 bg-line-strong" />
              </div>

              <div className="space-y-2">
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => handleSignIn(googleProvider, 'google')}
                    disabled={busy}
                    aria-label="Continue with Google"
                    title="Continue with Google"
                    className="flex items-center justify-center w-12 h-12 bg-surface-panel border border-line-strong rounded-lg hover:bg-surface-raised disabled:opacity-50 transition-colors"
                  >
                    {signingIn === 'google' ? (
                      <span className="text-xs text-ink-muted">…</span>
                    ) : (
                      <GoogleMark className="w-5 h-5" />
                    )}
                  </button>
                  <div className="relative group">
                    <button
                      onClick={() => handleSignIn(microsoftProvider, 'microsoft')}
                      disabled={busy}
                      aria-label="Continue with Microsoft (work account)"
                      className="flex items-center justify-center w-12 h-12 bg-surface-panel border border-line-strong rounded-lg hover:bg-surface-raised disabled:opacity-50 transition-colors"
                    >
                      {signingIn === 'microsoft' ? (
                        <span className="text-xs text-ink-muted">…</span>
                      ) : (
                        <MicrosoftMark className="w-5 h-5" />
                      )}
                    </button>
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap rounded-md bg-surface-raised border border-line-strong px-2 py-1 text-[11px] text-ink-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shadow-sm"
                    >
                      Microsoft requires a work account
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-700/60 rounded-lg p-4 text-center">
              <p className="text-red-300 text-sm leading-relaxed">{error}</p>
            </div>
          )}
        </div>
      </div>

      {showRequestAccess && (
        <RequestAccessModal
          defaultEmail={showRequestAccess.email}
          source={showRequestAccess.source}
          onClose={() => setShowRequestAccess(null)}
        />
      )}
    </div>
  );
}
