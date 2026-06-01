'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { signInWithPopup, signOut as firebaseSignOut, GoogleAuthProvider } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { apiClient, ApiError, type CaseInviteLookup } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';
import { FaGoogle } from 'react-icons/fa6';

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

  async function handleSignIn() {
    if (state.phase !== 'ready') return;
    const { invite } = state;

    setState({ phase: 'signing-in' });

    // Build a provider with login_hint so Google pre-selects the right account
    const provider = new GoogleAuthProvider();
    if (invite.email) {
      provider.setCustomParameters({ login_hint: invite.email });
    }

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
      <div className="min-h-screen flex items-center justify-center bg-surface px-4">
        <div className="w-full max-w-md">{children}</div>
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
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-bold text-ink">
            You&apos;ve been invited to join{' '}
            <span className="text-white">{invite.caseName ?? 'a case'}</span>
          </h1>
          {invite.inviterName && (
            <p className="text-ink-muted text-sm">{invite.inviterName} invited you</p>
          )}
        </div>

        {/* Role chip */}
        {invite.role && (
          <div className="flex justify-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border border-line-strong text-ink-muted">
              {invite.role === 'editor' ? 'As editor' : 'As viewer'}
            </span>
          </div>
        )}

        {/* Message */}
        {invite.message && (
          <div className="border border-line-strong rounded-lg px-4 py-3">
            <p className="text-ink text-sm whitespace-pre-wrap">{invite.message}</p>
          </div>
        )}

        {/* Gated email */}
        {invite.email && (
          <p className="text-ink-muted text-xs text-center">
            This invite is for{' '}
            <span className="font-mono text-ink">{invite.email}</span>
          </p>
        )}

        {/* Sign-in button */}
        <button
          onClick={handleSignIn}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors"
        >
          <FaGoogle className="w-5 h-5" />
          Sign in with Google
        </button>
      </Card>
    </Shell>
  );
}
