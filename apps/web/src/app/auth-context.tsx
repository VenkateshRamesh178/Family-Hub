import type { Identity } from '@family-hub/core';
import { ReauthRequiredError } from '@family-hub/drive-provider';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth, provider } from '../services';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export const REAUTH_EVENT = 'fh:reauth';

export function notifyIfReauth(e: unknown): void {
  if (e instanceof ReauthRequiredError) window.dispatchEvent(new Event(REAUTH_EVENT));
}

interface AuthState {
  status: AuthStatus;
  identity: Identity | null;
  /** Silent token renewal failed; show a "tap to continue" prompt. */
  needsReauth: boolean;
  error: unknown;
  signIn(): Promise<void>;
  signOut(): void;
  reportError(e: unknown): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadIdentity = useCallback(async () => {
    const me = await provider.getIdentity();
    auth.setLoginHint(me.email);
    setIdentity(me);
    setStatus('signedIn');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await auth.init();
        if (cancelled) return;
        if (auth.hasUsableToken()) await loadIdentity();
        else setStatus('signedOut');
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setStatus('signedOut');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadIdentity]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await auth.signIn();
      setNeedsReauth(false);
      if (!identity) await loadIdentity();
    } catch (e) {
      setError(e);
    }
  }, [identity, loadIdentity]);

  const signOut = useCallback(() => {
    auth.signOut();
    setIdentity(null);
    setStatus('signedOut');
    window.location.assign('/');
  }, []);

  const reportError = useCallback((e: unknown) => {
    if (e instanceof ReauthRequiredError) setNeedsReauth(true);
  }, []);

  // Query/mutation failures anywhere in the app are forwarded here (see main.tsx).
  useEffect(() => {
    const onReauth = () => setNeedsReauth(true);
    window.addEventListener(REAUTH_EVENT, onReauth);
    return () => window.removeEventListener(REAUTH_EVENT, onReauth);
  }, []);

  const value = useMemo(
    () => ({ status, identity, needsReauth, error, signIn, signOut, reportError }),
    [status, identity, needsReauth, error, signIn, signOut, reportError],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
