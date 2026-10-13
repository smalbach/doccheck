import { createContext } from 'react';
import type { MessageKey, MessageVars } from './keys';
import type { Locale } from './locales';

export interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: MessageVars) => string;
  /** "Oct 12, 2026, 9:28 p.m." in the chosen language. */
  formatDateTime: (value: string | number | Date) => string;
  /** 0.994 → "99.4%" (or "99,4 %"); null → "—". */
  formatPercent: (value: number | null | undefined) => string;
}

export const I18nContext = createContext<I18nState | null>(null);
