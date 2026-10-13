import { isLocale, LOCALE_KEY, type Locale } from './locales';
import { readPreference } from '../preferences/storage';

/** The stored choice, else the first browser language we have, else English. */
export function detectLocale(): Locale {
  const stored = readPreference(LOCALE_KEY);
  if (isLocale(stored)) return stored;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}
