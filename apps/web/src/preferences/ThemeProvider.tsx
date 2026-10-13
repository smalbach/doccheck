import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { applyTheme } from './applyTheme';
import { readPreference, writePreference } from './storage';
import { isTheme, THEME_KEY, type Theme } from './theme';
import { ThemeContext } from './ThemeContext';

/** Light, dark or the system's; remembered on this device. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = readPreference(THEME_KEY);
    return isTheme(stored) ? stored : 'system';
  });
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    writePreference(THEME_KEY, next);
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
