import { createContext } from 'react';
import type { User } from '../../api/types';

export interface AuthState {
  /** undefined while the session is being checked, null when signed out. */
  user: User | null | undefined;
  /** Resolves with a ticket when the account asks for a two-factor code next (completeMfa). */
  login: (email: string, password: string) => Promise<{ mfaTicket?: string }>;
  completeMfa: (ticket: string, code: string) => Promise<void>;
  register: (input: { email: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** After a profile change. */
  setUser: (user: User) => void;
}

export const AuthContext = createContext<AuthState | null>(null);
