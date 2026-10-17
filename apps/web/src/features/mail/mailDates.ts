/** Gmail-style list date: the time today, day and month this year, the full date before. */
export function shortMailDate(value: string, locale: string, now = new Date()): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const tag = locale === 'en' ? 'en-CA' : locale;
  if (d.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(tag, { timeStyle: 'short' }).format(d);
  if (d.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }).format(d);
  return new Intl.DateTimeFormat(tag, { dateStyle: 'short' }).format(d);
}
