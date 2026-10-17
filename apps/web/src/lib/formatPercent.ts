/** A share (0..1) as a percentage in the locale ("12 %" in French); "—" without one. */
export function formatPercent(share: number | null | undefined, locale: string, maxFractionDigits = 0): string {
  if (share === null || share === undefined || !Number.isFinite(share)) return '—';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: maxFractionDigits }).format(share);
}
