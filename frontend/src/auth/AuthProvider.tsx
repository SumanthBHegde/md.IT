import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { ApiError, getApi, request, type Me } from '../api';
import { loginUrl } from './loginUrl';
import { AuthContext, type Auth, type AuthState } from './useAuth';

/** After this long hidden, a visible tab checks the session again (it may have ended meanwhile). */
const RECHECK_AFTER_MS = 5 * 60_000;

export interface AuthProviderProps {
  children: ReactNode;
  /** Full-page navigation; injected by tests. */
  assign?: (url: string) => void;
}

/** Session state for the whole app (P-077). Only reads the server; local work never depends on it. */
export function AuthProvider({ children, assign = (url) => window.location.assign(url) }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const location = useLocation();
  const here = location.pathname + location.search;

  /** Who is signed in, and which providers the server offers (both again after a failure). */
  const refresh = useCallback(async () => {
    const api = getApi();
    const providersLoaded = request(() => api.GET('/api/auth/providers')).then(
      (body) => setProviders(body.providers),
      () => setProviders([]),
    );
    try {
      const me = await request(() => api.GET('/api/me'));
      setUser(me);
      setState('signed-in');
    } catch (error) {
      setUser(null);
      setState(error instanceof ApiError && error.status === 401 ? 'signed-out' : 'unavailable');
    }
    await providersLoaded;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      const since = hiddenAt.current;
      hiddenAt.current = null;
      if (since !== null && Date.now() - since > RECHECK_AFTER_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  const signIn = useCallback((provider: string, options?: { name?: string }) => assign(loginUrl(provider, here, options?.name)), [assign, here]);

  const signedOut = useCallback(() => {
    setUser(null);
    setState('signed-out');
  }, []);

  const signOut = useCallback(async () => {
    const api = getApi();
    await request(() => api.POST('/api/auth/logout'));
    signedOut();
  }, [signedOut]);

  const deleteAccount = useCallback(async () => {
    const api = getApi();
    await request(() => api.DELETE('/api/me'));
    signedOut();
  }, [signedOut]);

  const value = useMemo<Auth>(
    () => ({ state, user, providers, signIn, signOut, deleteAccount, sessionEnded: signedOut, refresh }),
    [state, user, providers, signIn, signOut, deleteAccount, signedOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
