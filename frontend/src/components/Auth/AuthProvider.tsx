'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, User as FirebaseUser } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';

interface DaubertUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  user: DaubertUser | null;
  loading: boolean;
  error: string | null;
  noAccount: boolean;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  user: null,
  loading: true,
  error: null,
  noAccount: false,
  signOut: async () => {},
  getToken: async () => null,
});

export function useAuth() {
  return useContext(AuthContext);
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [user, setUser] = useState<DaubertUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!firebaseUser) return null;
    try {
      return await firebaseUser.getIdToken();
    } catch {
      return null;
    }
  }, [firebaseUser]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
    setUser(null);
    setNoAccount(false);
    setError(null);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (fbUser) => {
      setFirebaseUser(fbUser);

      if (!fbUser) {
        setUser(null);
        setNoAccount(false);
        setError(null);
        setLoading(false);
        return;
      }

      // Verify account with backend
      try {
        const token = await fbUser.getIdToken();
        const res = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
          setNoAccount(false);
          setError(null);
        } else if (res.status === 403) {
          const body = await res.json().catch(() => ({}));
          if (body.code === 'NO_ACCOUNT') {
            setNoAccount(true);
            setUser(null);
          } else {
            setError('Access denied');
          }
        } else {
          setError('Failed to verify account');
        }
      } catch (err) {
        setError('Could not connect to server');
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ firebaseUser, user, loading, error, noAccount, signOut, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}
