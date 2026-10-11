import { ApiError, type SignUpInput } from '@family-hub/api-provider';
import type { Identity } from '@family-hub/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { provider } from '../services';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export const SESSION_EXPIRED_EVENT = 'fh:session-expired';

/** Query/mutation error hook (see main.tsx): a 401 anywhere means the session cookie is gone. */
export function notifyIfSignedOut(e: unknown): void {
  if (e instanceof ApiError && e.isUnauthorized) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

interface AuthState {
  status: AuthStatus;
  identity: Identity | null;
  /** Why the user is signed out, if it wasn't their choice (server down, session expired). */
  error: unknown;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<unknown>(null);

  const signedIn = useCallback((me: Identity) => {
    setIdentity(me);
    setError(null);
    setStatus('signedIn');
  }, []);

  const signedOut = useCallback(
    (why: unknown = null) => {
      qc.clear();
      setIdentity(null);
      setError(why);
      setStatus('signedOut');
    },
    [qc],
  );

  useEffect(() => {
    let cancelled = false;
    provider.getIdentity().then(
      (me) => !cancelled && signedIn(me),
      (e: unknown) => !cancelled && signedOut(e instanceof ApiError && e.isUnauthorized ? null : e),
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn, signedOut]);

  useEffect(() => {
    const onExpired = () => signedOut(new Error('Your session has ended. Please sign in again.'));
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [signedOut]);

  const signIn = useCallback(
    async (email: string, password: string) => signedIn(await provider.signIn(email, password)),
    [signedIn],
  );
  const signUp = useCallback(async (input: SignUpInput) => signedIn(await provider.signUp(input)), [signedIn]);
  const signOut = useCallback(async () => {
    await provider.signOut().catch(() => {});
    signedOut();
    window.history.replaceState(null, '', '/');
  }, [signedOut]);

  const value = useMemo(
    () => ({ status, identity, error, signIn, signUp, signOut }),
    [status, identity, error, signIn, signUp, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
