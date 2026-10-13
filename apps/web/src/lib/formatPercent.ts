/** 0.994 → "99.4%"; null or undefined → "—". */
export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}
