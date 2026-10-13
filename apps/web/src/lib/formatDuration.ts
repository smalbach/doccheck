import type { I18nState } from '../i18n/I18nContext';

/** 4200 → "4.2 s", 28 400 → "28 s", 65 000 → "1 min 5 s", in the interface language. */
export function formatDuration(ms: number, { t, formatNumber }: Pick<I18nState, 't' | 'formatNumber'>): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return t('progress.seconds', { seconds: formatNumber(Math.round(seconds * 10) / 10, 1) });
  if (seconds < 60) return t('progress.seconds', { seconds: formatNumber(Math.round(seconds), 0) });
  const whole = Math.round(seconds);
  return t('progress.minutes', { minutes: formatNumber(Math.floor(whole / 60), 0), seconds: formatNumber(whole % 60, 0) });
}
