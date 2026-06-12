'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { FaTriangleExclamation } from 'react-icons/fa6';
import { apiClient, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/Auth/AuthProvider';
import { Loader } from '@/components/Common/Loader';

/**
 * OAuth authorize **bridge page**.
 *
 * Why this page exists
 * --------------------
 * The OAuth flow starts when the MCP client (Claude Desktop, etc.) opens
 * `GET <BE>/oauth/authorize?...` in the system browser. A top-level browser
 * navigation NEVER carries an `Authorization: Bearer` header — Firebase
 * tokens live in JS, not in cookies — so the BE used to always 302 the
 * caller to `${FRONTEND_URL}/login?return_to=<encoded BE URL>`. The login
 * page would then `router.replace(returnTo)`, but the `return_to` was a BE
 * path (`/oauth/authorize?...`) which is NOT a Next.js route → 404.
 * Dead end.
 *
 * The fix is to give the FE a same-path route. The `return_to` after login
 * now resolves to THIS page (FE `/oauth/authorize?...`). This page:
 *   1. Waits for Firebase auth to resolve.
 *   2. If signed out → bounce to `/login?return_to=<here>` (relative, so the
 *      login page's `validateReturnTo` accepts it).
 *   3. If signed in → call the BE in JSON mode (Accept: application/json) via
 *      `apiClient.authorizeAgent(window.location.search)`. The BE responds
 *      with `{ redirectUrl: '/oauth/consent?bag=...' }`, and we drive the
 *      browser there with `window.location.href`.
 *
 * Inline error card mirrors `app/oauth/consent/page.tsx`'s
 * `ConsentErrorState` so 400/401 from the BE doesn't crash the page.
 */

/**
 * Navigation seam — kept module-local so tests can spy on it via
 * `jest.spyOn`. jsdom won't let us override `window.location` directly, so
 * the component goes through this helper instead. Mirrors `_consentNav` on
 * the consent screen.
 */
export const _authorizeNav = {
  redirect(url: string) {
    window.location.href = url;
  },
};

/**
 * Wraps an error string in a chrome-less card so unauthenticated /
 * invalid-link visitors see a clean screen instead of a crashed page.
 * Identical visual style to `ConsentErrorState` on the consent page.
 */
function AuthorizeErrorState({ message }: { message: string }) {
  return (
    <div className="relative min-h-screen bg-surface text-white overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid-faint -z-10" />
      <main className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col items-stretch justify-center px-6 py-10">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <Image src="/logo-light.png" alt="Daubert" width={26} height={26} priority />
          <span className="text-base font-semibold tracking-tight text-white">Daubert</span>
        </div>
        <div className="relative rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] p-6 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <FaTriangleExclamation size={14} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{message}</p>
              <p className="mt-1 text-xs text-ink-muted">
                Return to your AI agent and try connecting again.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function AuthorizeBridgeInner() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    // Not signed in — bounce to /login with a return_to that brings them
    // back HERE (the FE bridge route at this same path). The login page
    // validates that return_to is a relative same-origin path, so we pass
    // `pathname + search`, not absolute URL.
    if (!firebaseUser) {
      const returnTo = window.location.pathname + window.location.search;
      router.replace(`/login?return_to=${encodeURIComponent(returnTo)}`);
      return;
    }

    // Authenticated — call the BE in JSON mode. Pass the RAW query string
    // verbatim (do NOT re-encode); the BE expects the exact same
    // parameters the OAuth client sent.
    let cancelled = false;
    const search = window.location.search;
    apiClient
      .authorizeAgent(search)
      .then((res) => {
        if (cancelled) return;
        _authorizeNav.redirect(res.redirectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 401: session evaporated between mount and call → punt back to
        // login. 400: malformed OAuth params from the originating client →
        // surface an inline error (re-trying won't help).
        if (err instanceof ApiError && err.status === 401) {
          const returnTo = window.location.pathname + window.location.search;
          router.replace(`/login?return_to=${encodeURIComponent(returnTo)}`);
          return;
        }
        if (err instanceof ApiError && err.status === 400) {
          setFetchError('This authorization request is invalid or malformed.');
          return;
        }
        setFetchError(
          err instanceof Error
            ? err.message
            : 'Something went wrong starting this authorization.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, firebaseUser, router]);

  // Auth still resolving.
  if (authLoading) {
    return <Loader />;
  }

  // No firebase user — router.replace is async, render nothing to avoid a
  // flash of UI before navigation completes.
  if (!firebaseUser) {
    return null;
  }

  if (fetchError) {
    return <AuthorizeErrorState message={fetchError} />;
  }

  // Authenticated and the API call is in flight — show a loader. On
  // success we redirect via window.location, so this state lasts only
  // until the browser hop fires.
  return <Loader />;
}

export default function OAuthAuthorizeBridgePage() {
  // The bridge doesn't read `useSearchParams` (it uses `window.location`
  // directly to preserve the raw query string), so technically Suspense
  // isn't required here. We wrap anyway to match the consent page shape
  // and to be safe if a future refactor introduces a useSearchParams hook.
  return (
    <Suspense fallback={<Loader />}>
      <AuthorizeBridgeInner />
    </Suspense>
  );
}
