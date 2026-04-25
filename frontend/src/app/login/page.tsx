'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup } from 'firebase/auth';
import { getFirebaseAuth, googleProvider } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';
import { FaGoogle } from 'react-icons/fa6';

export default function LoginPage() {
  const router = useRouter();
  const { user, noAccount, loading, signOut } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already signed in with a valid account, redirect to home
  useEffect(() => {
    if (user && !loading) {
      router.replace('/');
    }
  }, [user, loading, router]);

  async function handleGoogleSignIn() {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithPopup(getFirebaseAuth(), googleProvider);
      // AuthProvider will handle the /auth/me check and set user or noAccount
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Sign-in failed');
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="max-w-sm w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">Daubert</h1>
          <p className="mt-2 text-gray-400 text-sm">
            Blockchain transaction investigation tool
          </p>
        </div>

        {noAccount ? (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-center">
            <p className="text-red-300 text-sm">
              No account found for {getFirebaseAuth().currentUser?.email}.
              <br />
              Contact your administrator to get access.
            </p>
            <button
              onClick={signOut}
              className="mt-4 text-sm text-gray-400 hover:text-white underline"
            >
              Sign in with a different account
            </button>
          </div>
        ) : (
          <button
            onClick={handleGoogleSignIn}
            disabled={signingIn || loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            <FaGoogle className="w-5 h-5" />
            {signingIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        )}

        {error && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
