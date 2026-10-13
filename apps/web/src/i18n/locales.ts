export type Locale = 'en' | 'es' | 'fr';

/** Each language under its own name, as people look for it. */
export const LOCALES: readonly { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
];

/** Same key as the inline script in index.html. */
export const LOCALE_KEY = 'doccheck.locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es' || value === 'fr';
}
