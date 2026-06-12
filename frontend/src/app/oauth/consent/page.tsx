'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaTriangleExclamation } from 'react-icons/fa6';
import { apiClient, ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/Auth/AuthProvider';
import { Loader } from '@/components/Common/Loader';
import type { components } from '@/generated/api-types';
import { ConsentScreen } from './ConsentScreen';

type Preview = components['schemas']['OAuthConsentPreview'];

/**
 * Wraps an error string in a chrome-less card so unauthenticated /
 * invalid-link visitors see a clean screen instead of a crashed page.
 */
function ConsentErrorState({ message }: { message: string }) {
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

function ConsentPageInner() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const bag = searchParams.get('bag') ?? '';

  const [preview, setPreview] = useState<Preview | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    // Not signed in — bounce to login with a return_to that brings them
    // back here. The login page validates that return_to is a relative
    // same-origin path (T20), so we must pass `pathname + search`, not the
    // absolute `window.location.href`.
    if (!firebaseUser) {
      const returnTo = window.location.pathname + window.location.search;
      router.replace(`/login?return_to=${encodeURIComponent(returnTo)}`);
      return;
    }

    // Missing bag — surface as an error state instead of calling the API.
    if (!bag) {
      setFetchError('This consent link is missing required parameters.');
      return;
    }

    let cancelled = false;
    apiClient
      .previewConsent(bag)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 400 = invalid / expired signed bag; 403 = not eligible to consent.
        if (err instanceof ApiError && (err.status === 400 || err.status === 403)) {
          setFetchError('This consent link is invalid or has expired.');
        } else {
          setFetchError(
            err instanceof Error
              ? err.message
              : 'Something went wrong loading this consent request.',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, firebaseUser, bag, router]);

  // Auth still resolving.
  if (authLoading) {
    return <Loader />;
  }

  // No firebase user — router.replace is async, render nothing to avoid a
  // flash of the form before navigation completes.
  if (!firebaseUser) {
    return null;
  }

  if (fetchError) {
    return <ConsentErrorState message={fetchError} />;
  }

  if (!preview) {
    return <Loader />;
  }

  return <ConsentScreen bag={bag} preview={preview} />;
}

export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<Loader />}>
      <ConsentPageInner />
    </Suspense>
  );
}
