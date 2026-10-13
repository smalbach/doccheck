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
  /** "12500.5" → "12,500.5" (or "12 500,5"); missing → "—". */
  formatNumber: (value: string | number | null | undefined, maxFractionDigits?: number) => string;
  /** "48600.00", "USD" → "US$48,600.00" in the chosen language. */
  formatMoney: (amount: string | number | null | undefined, currency: string) => string;
}

export const I18nContext = createContext<I18nState | null>(null);
