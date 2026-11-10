import type { AuthResponse, AuthUser } from '@pos/shared-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, setUnauthorizedHandler, tokenStore } from './api';
import { openPos } from './openPos';

interface AuthState {
  user: AuthUser | null;
  /** true until the stored token has been checked on page load */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  setUser: (u: AuthUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return setLoading(false);
    api<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, [logout]);

  const accept = (r: AuthResponse) => {
    tokenStore.set(r.accessToken);
    setUser(r.user);
  };

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      logout,
      setUser,
      login: async (email, password) => accept(await api('/auth/login', { method: 'POST', json: { email, password } })),
      register: async (fullName, email, password) =>
        accept(await api('/auth/register', { method: 'POST', json: { fullName, email, password } })),
    }),
    [user, loading, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Route wrapper: sends signed-out visitors to /login and back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Route wrapper for owner-only pages. The API enforces this too; this only hides the UI. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <RequireAuth>
      {user?.role === 'ADMIN' ? children : <Navigate to="/" replace />}
    </RequireAuth>
  );
}

/**
 * Route wrapper for login/register. Once signed in (just now, or already):
 * the owner goes to the admin page (or the page that sent them to login),
 * everyone else goes straight into their POS.
 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const from = (useLocation().state as { from?: string } | null)?.from;
  if (loading) return null;
  if (user?.role === 'ADMIN') return <Navigate to={from ?? '/admin'} replace />;
  if (user) return <OpenPos />;
  return <>{children}</>;
}

/** Hands the signed-in user over to the POS (see lib/openPos.ts). */
export function OpenPos() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    openPos().catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="py-20 text-center">
      {error ? (
        <>
          <p className="font-medium text-red-700">Couldn&apos;t open the POS: {error}</p>
          <button className="mt-3 text-sm text-indigo-600 underline" onClick={() => location.reload()}>Try again</button>
        </>
      ) : (
        <p className="text-slate-500">Opening your POS…</p>
      )}
    </div>
  );
}
