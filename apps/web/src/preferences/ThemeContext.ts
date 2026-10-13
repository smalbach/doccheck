import { createContext } from 'react';
import type { Theme } from './theme';

export interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeState | null>(null);
