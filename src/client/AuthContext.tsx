import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiFetch, setAuthToken } from './api.ts';
import type { SessionContext } from '../shared/types.ts';

export interface DemoPersona {
  userId: string;
  uid: string;
  fullName: string;
  email: string;
  roleKey: string;
  permittedFacilityIds: string[];
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
}

interface AuthContextValue {
  session: SessionContext | null;
  personas: DemoPersona[];
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<boolean>;
  signInDemoPersona: (uid: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<SessionContext | null>(null);
  const [personas, setPersonas] = useState<DemoPersona[]>([]);
  // Never block first paint of the public site waiting for third-party Firebase storage checks
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadPersonas = useCallback(async () => {
    try {
      const data = await apiFetch<{ personas: DemoPersona[] }>('/api/auth/demo-personas');
      setPersonas(data.personas);
    } catch {
      // retry silently later
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const data = await apiFetch<{ session: SessionContext }>('/api/auth/me');
      setSession(data.session);
    } catch {
      setSession(null);
      setAuthToken(null);
    }
  }, []);

  useEffect(() => {
    loadPersonas();

    if (!auth) {
      return;
    }

    let unsub: (() => void) | undefined;
    try {
      unsub = onAuthStateChanged(
        auth,
        async (fbUser) => {
          if (fbUser) {
            setLoading(true);
            try {
              const idToken = await fbUser.getIdToken();
              setAuthToken(idToken);
              const data = await apiFetch<{ session: SessionContext }>('/api/auth/me');
              setSession(data.session);
            } catch (err) {
              console.error('Failed to establish Firebase session:', err);
              setAuthToken(null);
              setSession(null);
            } finally {
              setLoading(false);
            }
          }
        },
        (err) => {
          console.warn('Firebase auth listener error:', err);
          setLoading(false);
        },
      );
    } catch (err) {
      console.warn('Unable to subscribe to Firebase auth state:', err);
    }

    return () => {
      if (unsub) unsub();
    };
  }, [loadPersonas]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    if (!auth) {
      setAuthError('Google Sign-In is unavailable in this browser privacy mode. Use a workspace account below.');
      return false;
    }
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setAuthToken(idToken);
      const data = await apiFetch<{ session: SessionContext }>('/api/auth/me');
      setSession(data.session);
      return true;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In did not complete.');
      return false;
    }
  }, []);

  const signInDemoPersona = useCallback(async (uid: string) => {
    setAuthError(null);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/demo-session', {
        method: 'POST',
        body: JSON.stringify({ uid }),
      });
      setAuthToken(res.token);
      const me = await apiFetch<{ session: SessionContext }>('/api/auth/me');
      setSession(me.session);
      return true;
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to start demo workspace session.');
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setSession(null);
    if (auth) {
      try {
        await firebaseSignOut(auth);
      } catch {
        // ignore if demo session only
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        personas,
        loading,
        authError,
        signInWithGoogle,
        signInDemoPersona,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
