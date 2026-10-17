import { useI18n } from '../i18n/useI18n';

/** "2026-03" as "Mar 2026" in the interface language. */
export function useMonthLabel(): (month: string) => string {
  const { locale } = useI18n();
  const format = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (month) => {
    const [y, m] = month.split('-').map(Number);
    return y && m ? format.format(new Date(Date.UTC(y, m - 1, 1))) : month;
  };
}
