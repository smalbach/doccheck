import { createContext } from 'react';
import type { User } from '../../api/types';

export interface AuthState {
  /** undefined while the session is being checked, null when signed out. */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { email: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** After a profile change. */
  setUser: (user: User) => void;
}

export const AuthContext = createContext<AuthState | null>(null);
