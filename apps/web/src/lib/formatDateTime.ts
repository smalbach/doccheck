const formatter = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });

/** "Oct 12, 2026, 9:28 p.m.": English like the rest of the UI, and never ambiguous about day and month. */
export function formatDateTime(iso: string | number | Date): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : formatter.format(date);
}
