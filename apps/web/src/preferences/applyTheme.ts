import type { Theme } from './theme';

/** "system" removes the attribute so prefers-color-scheme decides (styles/tokens.css). */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
