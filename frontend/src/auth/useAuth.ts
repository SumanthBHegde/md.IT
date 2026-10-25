import { createContext, useContext } from 'react';
import type { Me } from '../api';

/** `unavailable`: the server couldn't be reached; it behaves like signed out. */
export type AuthState = 'loading' | 'signed-out' | 'signed-in' | 'unavailable';

export interface Auth {
  state: AuthState;
  user: Me | null;
  /** Sign-in providers the server offers, in its order (e.g. github, google, dev). */
  providers: string[];
  /** Leave the page to sign in; comes back to the current path. */
  signIn(provider: string, options?: { name?: string }): void;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
  /** A cloud call answered 401: the session is over. */
  sessionEnded(): void;
  refresh(): Promise<void>;
}

const noop = async () => {};

/** Outside an AuthProvider (isolated component tests) the app is simply signed out. */
export const SIGNED_OUT: Auth = {
  state: 'signed-out',
  user: null,
  providers: [],
  signIn: () => {},
  signOut: noop,
  deleteAccount: noop,
  sessionEnded: () => {},
  refresh: noop,
};

export const AuthContext = createContext<Auth>(SIGNED_OUT);

export function useAuth(): Auth {
  return useContext(AuthContext);
}
