'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Loader } from '@/components/Common/Loader';
import { RequestAccessModal } from './RequestAccessModal';

/**
 * Wraps authenticated pages. Redirects to /login if not signed in OR if the
 * backend can't be reached during account verification (better than spinning
 * forever on a "Loading…" state that hides a backend-down condition from the
 * user). Shows rejection message if NO_ACCOUNT.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, noAccount, firebaseUser, error } = useAuth();
  const router = useRouter();
  const [showRequestAccess, setShowRequestAccess] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace('/login');
      return;
    }
    // Backend unreachable during /auth/me — kick to login instead of hanging
    // on a loading spinner. The login page can re-attempt verification when
    // backend recovers.
    if (error && !user && !noAccount) {
      router.replace('/login');
    }
  }, [loading, firebaseUser, error, user, noAccount, router]);

  if (loading) {
    return <Loader />;
  }

  if (!firebaseUser) {
    return null; // Will redirect
  }

  if (noAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-ink">No Account Found</h2>
          <p className="text-ink-muted">
            No account found for {firebaseUser.email}.
          </p>
          <button
            type="button"
            onClick={() => setShowRequestAccess(true)}
            className="px-4 py-2 bg-brand hover:bg-brand/90 rounded text-sm text-white font-medium transition-colors"
          >
            Request access
          </button>
        </div>
        {showRequestAccess && (
          <RequestAccessModal
            defaultEmail={firebaseUser.email ?? ''}
            source="auth-guard"
            onClose={() => setShowRequestAccess(false)}
          />
        )}
      </div>
    );
  }

  if (!user) {
    return <Loader />;
  }

  return <>{children}</>;
}
