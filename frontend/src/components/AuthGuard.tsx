'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

/**
 * Wraps authenticated pages. Redirects to /login if not signed in,
 * shows rejection message if NO_ACCOUNT, renders children if valid.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, noAccount, firebaseUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace('/login');
    }
  }, [loading, firebaseUser, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (!firebaseUser) {
    return null; // Will redirect
  }

  if (noAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-white">No Account Found</h2>
          <p className="text-gray-400">
            No account found for {firebaseUser.email}.
            Contact your administrator to get access.
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
