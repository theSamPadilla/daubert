'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { signInWithPopup, signOut as firebaseSignOut, GoogleAuthProvider, OAuthProvider, type AuthProvider } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { apiClient, ApiError } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';
import Image from 'next/image';
import type { components } from '@/generated/api-types';

type OrgInviteLookup = components['schemas']['OrganizationInviteLookup'];

const ROLE_DESCRIPTIONS: Record<string, string> = {
  member: 'Can view and work within cases in this organization.',
  guest: 'Limited access to assigned cases only.',
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
  | { phase: 'ready'; invite: OrgInviteLookup }
  | { phase: 'error'; message: string }
  | { phase: 'signing-in' }
  | { phase: 'mismatch'; inviteEmail: string }
  | { phase: 'done' };

export default function OrgInvitePage() {
  const params = useParams();
  const code = params.code as string;

  const [state, setState] = useState<PageState>({ phase: 'loading' });

  useEffect(() => {
    if (!code) return;
    (async () => {
      try {
        const invite = await apiClient.lookupOrgInvite(code);
        setState({ phase: 'ready', invite });
      } catch (err: any) {
        setState({ phase: 'error', message: err.message || 'Failed to load invite.' });
      }
    })();
  }, [code]);

  async function acceptAfterSignIn() {
    try {
      const result = await apiClient.acceptOrgInvite(code);
      setState({ phase: 'done' });
      // Hard navigation forces AuthProvider to refetch /auth/me (which now succeeds
      // because the user shell was just created/linked by acceptOrgInvite).
      window.location.href = result.alreadyMember ? '/' : `/orgs/${result.orgSlug}/settings`;
    } catch (err: any) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 403) {
        // Re-lookup so we have the email to display in the mismatch state.
        try {
          const refreshed = await apiClient.lookupOrgInvite(code);
          setState({ phase: 'mismatch', inviteEmail: refreshed.email ?? '' });
        } catch {
          setState({ phase: 'mismatch', inviteEmail: '' });
        }
        return;
      }
      if (status === 410) {
        try {
          const refreshed = await apiClient.lookupOrgInvite(code);
          setState({ phase: 'ready', invite: refreshed });
        } catch (lookupErr: any) {
          setState({ phase: 'error', message: lookupErr.message || 'Invite is no longer available.' });
        }
        return;
      }
      setState({ phase: 'error', message: err.message || 'Failed to accept invite.' });
    }
  }

  async function handleSignIn(kind: 'google' | 'microsoft') {
    if (state.phase !== 'ready') return;
    const { invite } = state;

    setState({ phase: 'signing-in' });

    const provider = buildProvider(kind, invite.email ?? undefined);

    try {
      await signInWithPopup(getFirebaseAuth(), provider);
      await acceptAfterSignIn();
    } catch (err: any) {
      setState({
        phase: 'error',
        message: err.message || 'Sign-in failed. Please try again.',
      });
    }
  }

  async function handleSignOut() {
    await firebaseSignOut(getFirebaseAuth());
    setState({ phase: 'loading' });
    try {
      const invite = await apiClient.lookupOrgInvite(code);
      setState({ phase: 'ready', invite });
    } catch (err: any) {
      setState({ phase: 'error', message: err.message || 'Failed to reload invite.' });
    }
  }

  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center bg-surface bg-hero-dark px-4 py-10 overflow-hidden">
        <div className="pointer-events-none absolute -right-40 -bottom-40 -z-10 opacity-[0.05] select-none">
          <Image src="/logo-light.png" alt="" width={720} height={720} priority />
        </div>
        <div className="pointer-events-none absolute -left-40 -top-40 -z-10 opacity-[0.04] select-none">
          <Image src="/logo-light.png" alt="" width={560} height={560} priority />
        </div>
        <div className="relative w-full max-w-md flex flex-col items-center gap-8">
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

  const { invite } = state;
  const { status } = invite;

  if (status === 'expired') {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-semibold text-ink text-center">This invite has expired</h2>
          <p className="text-ink-muted text-sm text-center">
            Ask the org admin to send a new one.
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

  return (
    <Shell>
      <Card>
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-brand font-semibold">
            You&apos;re invited
          </p>
          <h1 className="mt-3 text-3xl font-bold text-white tracking-tight">
            {invite.orgName ?? 'an organization'}
          </h1>
          {invite.inviterName && (
            <p className="mt-2 text-sm text-ink-muted">
              from <span className="text-ink">{invite.inviterName}</span>
            </p>
          )}
        </div>

        {invite.role && (
          <div className="text-center space-y-1">
            <p className="text-brand font-semibold text-sm">
              {invite.role === 'member' ? 'Member' : 'Guest'}
            </p>
            <p className="text-ink-muted text-sm">
              {ROLE_DESCRIPTIONS[invite.role] ?? ''}
            </p>
          </div>
        )}

        {invite.message && (
          <div className="border border-line-strong rounded-lg px-4 py-3">
            <p className="text-ink text-sm whitespace-pre-wrap">{invite.message}</p>
          </div>
        )}

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
