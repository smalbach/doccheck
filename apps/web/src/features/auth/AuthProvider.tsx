import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { UNAUTHORIZED_EVENT } from '../../api/request';
import { teamApi } from '../../api/teamClient';
import type { User } from '../../api/types';
import { AuthContext, type AuthState } from './AuthContext';

/** Holds the signed-in user: asked once on load, cleared when any call answers 401. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>();

  useEffect(() => {
    let active = true;
    api.me().then(
      (u) => active && setUser(u),
      () => active && setUser(null),
    );
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      active = false;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = (await api.login({ email, password })) as User | { mfaRequired: true; ticket: string };
    if ('mfaRequired' in result) return { mfaTicket: result.ticket };
    setUser(result);
    return {};
  }, []);
  const completeMfa = useCallback(async (ticket: string, code: string) => setUser(await teamApi.loginWithCode(ticket, code)), []);
  const register = useCallback(async (input: { email: string; password: string; name: string }) => setUser(await api.register(input)), []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(() => ({ user, login, completeMfa, register, logout, setUser }), [user, login, completeMfa, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
