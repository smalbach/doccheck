import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { writePreference } from '../preferences/storage';
import { I18nContext, type I18nState } from './I18nContext';
import type { MessageKey, MessageVars } from './keys';
import { loadMessages } from './loadMessages';
import { LOCALE_KEY, type Locale } from './locales';
import type { Messages } from './messages/en';
import { translate } from './translate';

export interface I18nProviderProps {
  /** Language and dictionary loaded before the first render (main.tsx), so nothing flashes in English. */
  initialLocale: Locale;
  initialMessages: Messages;
  children: ReactNode;
}

/** Language of the interface; sets <html lang> so screen readers pronounce it right. */
export function I18nProvider({ initialLocale, initialMessages, children }: I18nProviderProps) {
  const [current, setCurrent] = useState({ locale: initialLocale, messages: initialMessages });
  const { locale, messages } = current;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // The switch happens once the new dictionary is in; if it cannot be fetched, the language stays.
  const setLocale = useCallback((next: Locale) => {
    void loadMessages(next).then(
      (loaded) => {
        setCurrent({ locale: next, messages: loaded });
        writePreference(LOCALE_KEY, next);
      },
      () => undefined,
    );
  }, []);

  const value = useMemo<I18nState>(() => {
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
  }, [locale, messages, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
