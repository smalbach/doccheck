/** "2026-11-01T00:00:00.000Z" as a date in the reader's language, read in UTC (the counters' month). */
export function usageDate(iso: string, locale: string, month = false): string {
  return new Date(iso).toLocaleDateString(locale, month ? { year: 'numeric', month: 'long', timeZone: 'UTC' } : { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
