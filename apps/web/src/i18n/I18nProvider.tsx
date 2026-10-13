import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { writePreference } from '../preferences/storage';
import { detectLocale } from './detectLocale';
import { I18nContext, type I18nState } from './I18nContext';
import type { MessageKey, MessageVars } from './keys';
import { LOCALE_KEY, MESSAGES, type Locale } from './locales';
import { translate } from './translate';

/** Language of the interface; sets <html lang> so screen readers pronounce it right. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writePreference(LOCALE_KEY, next);
  }, []);

  const value = useMemo<I18nState>(() => {
    const messages = MESSAGES[locale];
    const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-CA' : locale, { dateStyle: 'medium', timeStyle: 'short' });
    const percent = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return {
      locale,
      setLocale,
      t: (key: MessageKey, vars?: MessageVars) => translate(messages, locale, key, vars),
      formatDateTime: (v) => {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? '—' : date.format(d);
      },
      formatPercent: (v) => (v === null || v === undefined ? '—' : percent.format(v)),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
