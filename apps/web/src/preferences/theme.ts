export type Theme = 'light' | 'dark' | 'system';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/** Same key as the inline script in index.html, which applies it before the first paint. */
export const THEME_KEY = 'doccheck.theme';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}
