'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { signInWithPopup, signOut as firebaseSignOut, GoogleAuthProvider, OAuthProvider, type AuthProvider } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { apiClient, ApiError, type CaseInviteLookup } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';
import Image from 'next/image';

const ROLE_DESCRIPTIONS: Record<string, string> = {
  viewer: 'Read-only access to this case.',
  editor: 'Can edit investigations, traces, and files.',
};

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
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
      <path fill="currentColor" d="M3 3h8.5v8.5H3V3Z" />
      <path fill="currentColor" d="M12.5 3H21v8.5h-8.5V3Z" />
      <path fill="currentColor" d="M3 12.5h8.5V21H3v-8.5Z" />
      <path fill="currentColor" d="M12.5 12.5H21V21h-8.5v-8.5Z" />
    </svg>
  );
}

function buildProvider(kind: 'google' | 'microsoft', loginHint?: string): AuthProvider {
  if (kind === 'google') {
    const p = new GoogleAuthProvider();
    p.setCustomParameters(loginHint ? { login_hint: loginHint } : { prompt: 'select_account' });
    return p;
  }
  const p = new OAuthProvider('microsoft.com');
  p.setCustomParameters({
    prompt: 'select_account',
    tenant: 'organizations',
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return p;
}

type PageState =
  | { phase: 'loading' }
  | { phase: 'ready'; invite: CaseInviteLookup }
  | { phase: 'error'; message: string }
  | { phase: 'signing-in' }
  | { phase: 'mismatch'; inviteEmail: string }
  | { phase: 'done' };

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  const [state, setState] = useState<PageState>({ phase: 'loading' });

  useEffect(() => {
    if (!code) return;
    apiClient
      .lookupInvite(code)
      .then((invite) => setState({ phase: 'ready', invite }))
      .catch((err: Error) =>
        setState({ phase: 'error', message: err.message || 'Failed to load invite.' }),
      );
  }, [code]);

  async function handleSignIn(kind: 'google' | 'microsoft') {
    if (state.phase !== 'ready') return;
    const { invite } = state;

    setState({ phase: 'signing-in' });

    const provider = buildProvider(kind, invite.email ?? undefined);

    try {
      await signInWithPopup(getFirebaseAuth(), provider);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        // User dismissed — go back to the card
        setState({ phase: 'ready', invite });
        return;
      }
      setState({
        phase: 'error',
        message: err.message || 'Sign-in failed. Please try again.',
      });
      return;
    }

    // Sign-in succeeded — call accept
    try {
      const result = await apiClient.acceptInvite(code);
      setState({ phase: 'done' });
      router.push(`/cases/${result.caseId}`);
    } catch (err: any) {
      const status = err instanceof ApiError ? err.status : 0;
      // 403 = email mismatch
      if (status === 403) {
        setState({ phase: 'mismatch', inviteEmail: invite.email ?? '' });
        return;
      }
      // 410 = used or expired — re-fetch to show correct status card
      if (status === 410) {
        try {
          const refreshed = await apiClient.lookupInvite(code);
          setState({ phase: 'ready', invite: refreshed });
        } catch {
          setState({ phase: 'ready', invite: { ...invite, status: 'used' } });
        }
        return;
      }
      setState({ phase: 'error', message: err.message || 'Failed to accept invite.' });
    }
  }

  async function handleSignOut() {
    await firebaseSignOut(getFirebaseAuth());
    // Re-fetch the invite so user can try again
    setState({ phase: 'loading' });
    try {
      const invite = await apiClient.lookupInvite(code);
      setState({ phase: 'ready', invite });
    } catch (err: any) {
      setState({ phase: 'error', message: err.message || 'Failed to reload invite.' });
    }
  }

  // ── Layout shell ──────────────────────────────────────────────────────────
  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface px-4 py-10">
        <div className="w-full max-w-md flex flex-col items-center gap-8">
          <Image
            src="/logo-light.png"
            alt="Daubert"
            width={72}
            height={72}
            priority
            className="opacity-95"
          />
          <div className="w-full">{children}</div>
        </div>
      </div>
    );
  }

  function Card({ children }: { children: React.ReactNode }) {
    return (
      <div className="bg-surface-panel border border-line-strong rounded-xl p-8 space-y-6">
        {children}
      </div>
    );
  }

  // ── States ────────────────────────────────────────────────────────────────

  if (state.phase === 'loading' || state.phase === 'done') {
    return <Loader />;
  }

  if (state.phase === 'signing-in') {
    return (
      <Shell>
        <Card>
          <p className="text-ink-muted text-sm text-center">Completing sign-in...</p>
        </Card>
      </Shell>
    );
  }

  if (state.phase === 'error') {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-ink text-center">Something went wrong</h2>
          <p className="text-ink-muted text-sm text-center">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  if (state.phase === 'mismatch') {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-ink text-center">Wrong account</h2>
          <p className="text-ink-muted text-sm text-center">
            This invite is for{' '}
            <span className="font-mono text-ink">{state.inviteEmail}</span>. Sign out and try
            again with that account.
          </p>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-line-strong rounded-lg text-sm text-ink hover:bg-surface transition-colors"
          >
            Sign out
          </button>
        </Card>
      </Shell>
    );
  }

  // phase === 'ready'
  const { invite } = state;
  const { status } = invite;

  if (status === 'expired') {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-ink text-center">This invite has expired</h2>
          <p className="text-ink-muted text-sm text-center">
            Ask the case owner to send a new one.
          </p>
        </Card>
      </Shell>
    );
  }

  if (status === 'used') {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-ink text-center">
            This invite has already been used
          </h2>
        </Card>
      </Shell>
    );
  }

  if (status === 'revoked') {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-ink text-center">
            This invite is no longer valid
          </h2>
        </Card>
      </Shell>
    );
  }

  // status === 'pending'
  return (
    <Shell>
      <Card>
        {/* Heading */}
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-brand font-semibold">
            You&apos;re invited
          </p>
          <h1 className="mt-3 text-3xl font-bold text-white tracking-tight">
            {invite.caseName ?? 'a case'}
          </h1>
          {invite.inviterName && (
            <p className="mt-2 text-sm text-ink-muted">
              from <span className="text-ink">{invite.inviterName}</span>
            </p>
          )}
        </div>

        {/* Role row */}
        {invite.role && (
          <p className="text-center text-sm">
            <span className="text-brand font-semibold">
              {invite.role === 'editor' ? 'Editor' : 'Viewer'}
            </span>
            <span className="text-ink-muted"> &middot; {ROLE_DESCRIPTIONS[invite.role] ?? ''}</span>
          </p>
        )}

        {/* Message (only if present) */}
        {invite.message && (
          <div className="border border-line-strong rounded-lg px-4 py-3">
            <p className="text-ink text-sm whitespace-pre-wrap">{invite.message}</p>
          </div>
        )}

        {/* Sign-in buttons + email helper */}
        <div className="space-y-2">
          <button
            onClick={() => handleSignIn('google')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors"
          >
            <GoogleLogo className="w-5 h-5" />
            Sign in with Google
          </button>
          <button
            onClick={() => handleSignIn('microsoft')}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-surface-panel border border-line-strong text-white rounded-lg font-medium hover:bg-surface-raised transition-colors"
          >
            <MicrosoftMark className="w-5 h-5" />
            Sign in with Microsoft
          </button>
          <p className="text-ink-faint text-xs text-center pt-1">
            Microsoft sign-in requires a work account.
          </p>
          {invite.email && (
            <p className="text-ink-faint text-xs text-center">
              Sign in as <span className="font-mono text-ink-muted">{invite.email}</span>
            </p>
          )}
        </div>
      </Card>
    </Shell>
  );
}
