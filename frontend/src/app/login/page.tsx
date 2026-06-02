'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { signInWithPopup, type AuthProvider } from 'firebase/auth';
import { getFirebaseAuth, googleProvider, microsoftProvider } from '@/lib/firebase';
import { useAuth } from '@/components/Auth/AuthProvider';

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
        className="pointer-events-none absolute inset-0 h-full w-full text-brand/35"
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
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M21.6 12.227c0-.703-.063-1.379-.18-2.027H12v3.838h5.382a4.6 4.6 0 0 1-1.997 3.018v2.51h3.229c1.889-1.738 2.986-4.297 2.986-7.34Z"
      />
      <path
        fill="currentColor"
        d="M12 22c2.7 0 4.963-.895 6.614-2.434l-3.229-2.51c-.894.6-2.038.955-3.385.955-2.604 0-4.81-1.756-5.598-4.122H3.067v2.59A9.997 9.997 0 0 0 12 22Z"
      />
      <path
        fill="currentColor"
        d="M6.402 13.89A6.018 6.018 0 0 1 6.09 12c0-.658.114-1.297.311-1.89v-2.59H3.067A9.99 9.99 0 0 0 2 12c0 1.614.387 3.14 1.067 4.48l3.335-2.59Z"
      />
      <path
        fill="currentColor"
        d="M12 5.988c1.469 0 2.786.505 3.823 1.497l2.864-2.866C16.957 2.99 14.695 2 12 2A9.997 9.997 0 0 0 3.067 7.52L6.402 10.11C7.19 7.744 9.396 5.988 12 5.988Z"
      />
    </svg>
  );
}

function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="currentColor" d="M3 3h8.5v8.5H3V3Z" />
      <path fill="currentColor" d="M12.5 3H21v8.5h-8.5V3Z" />
      <path fill="currentColor" d="M3 12.5h8.5V21H3v-8.5Z" />
      <path fill="currentColor" d="M12.5 12.5H21V21h-8.5v-8.5Z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, noAccount, loading, signOut } = useAuth();
  const [signingIn, setSigningIn] = useState<'google' | 'microsoft' | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="relative min-h-screen flex items-center justify-center bg-surface bg-hero-dark px-4 py-10 overflow-hidden">
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

        <div className="w-full max-w-sm space-y-3">
          {noAccount ? (
            <div className="bg-red-900/30 border border-red-700/60 rounded-lg p-5 text-center">
              <p className="text-red-300 text-base">
                No account found for {getFirebaseAuth().currentUser?.email}.
              </p>
              <p className="mt-1 text-red-300/80 text-sm">
                Contact our team to get access.
              </p>
              <button
                onClick={async () => {
                  await signOut();
                  window.location.reload();
                }}
                className="mt-4 text-sm text-ink-muted hover:text-white underline"
              >
                Sign in with a different account
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => handleSignIn(googleProvider, 'google')}
                disabled={busy}
                className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-white text-gray-900 rounded-lg text-base font-medium shadow-[0_10px_40px_-10px_rgba(84,104,198,0.4)] hover:bg-gray-100 hover:shadow-[0_15px_50px_-10px_rgba(84,104,198,0.5)] disabled:opacity-50 transition-all"
              >
                <GoogleMark className="w-5 h-5" />
                {signingIn === 'google' ? 'Signing in...' : 'Continue with Google'}
              </button>
              <button
                onClick={() => handleSignIn(microsoftProvider, 'microsoft')}
                disabled={busy}
                className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-surface-panel border border-line-strong text-white rounded-lg text-base font-medium hover:bg-surface-raised disabled:opacity-50 transition-colors"
              >
                <MicrosoftMark className="w-5 h-5" />
                {signingIn === 'microsoft' ? 'Signing in...' : 'Continue with Microsoft'}
              </button>
              <p className="text-ink-faint text-xs text-center pt-1">
                Microsoft sign-in requires a work account.
              </p>
            </>
          )}

          {error && (
            <div className="bg-red-900/30 border border-red-700/60 rounded-lg p-4 text-center">
              <p className="text-red-300 text-sm leading-relaxed">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
