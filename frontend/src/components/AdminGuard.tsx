'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Loader } from './Loader';
import { ADMIN_EMAIL_DOMAIN } from '@/lib/admin';

/**
 * Wraps admin-only pages. Redirects to /login if not signed in,
 * shows "No Account" if noAccount, shows "Access Denied" if not admin,
 * renders children if valid admin.
 * Admin = email domain matches ADMIN_EMAIL_DOMAIN (also enforced by backend IsAdminGuard).
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, noAccount, firebaseUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !firebaseUser) {
      router.replace('/login');
    }
  }, [loading, firebaseUser, router]);

  if (loading) {
    return <Loader />;
  }

  if (!firebaseUser) {
    return null;
  }

  if (noAccount) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-white">No Account Found</h2>
          <p className="text-gray-400">
            No account found for {firebaseUser.email}.
            Contact our team to get access.
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Loader />;
  }

  if (user.email.split('@')[1] !== ADMIN_EMAIL_DOMAIN) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-white">Access Denied</h2>
          <p className="text-gray-400">
            This page requires administrator access.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
