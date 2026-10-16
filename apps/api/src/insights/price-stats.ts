import { fromFixed, toFixed } from '@doccheck/rules';

/**
 * The spread of unit prices in one group (a product, or an HS-6 subheading from one origin) in one
 * currency and unit. Quartiles are nearest-rank values (always prices that were paid, like
 * percentile_disc), and an outlier is outside Tukey's fences, 1.5 × IQR beyond the quartiles.
 * Fixed-point decimals throughout; groups of fewer than MIN_POINTS mark no outliers.
 */
export const MIN_POINTS = 4;

export interface PriceStats {
  n: number;
  min: string;
  q1: string;
  median: string;
  q3: string;
  max: string;
  /** Fences: below `low` or above `high` is an outlier. Absent with fewer than MIN_POINTS prices. */
  low?: string;
  high?: string;
}

/** Nearest-rank percentile (p in 0..1) of sorted values. */
const rank = <T>(sorted: readonly T[], p: number): T => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

const DECIMALS = 4;

export function priceStats(prices: readonly string[]): PriceStats | undefined {
  if (prices.length === 0) return undefined;
  const sorted = prices.map(toFixed).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const q1 = rank(sorted, 0.25);
  const q3 = rank(sorted, 0.75);
  const out: PriceStats = {
    n: sorted.length,
    min: fromFixed(sorted[0], DECIMALS),
    q1: fromFixed(q1, DECIMALS),
    median: fromFixed(rank(sorted, 0.5), DECIMALS),
    q3: fromFixed(q3, DECIMALS),
    max: fromFixed(sorted.at(-1)!, DECIMALS),
  };
  if (sorted.length >= MIN_POINTS) {
    const reach = ((q3 - q1) * 3n) / 2n;
    out.low = fromFixed(q1 - reach, DECIMALS);
    out.high = fromFixed(q3 + reach, DECIMALS);
  }
  return out;
}

export const isOutlier = (price: string, s: PriceStats): boolean =>
  s.low !== undefined && s.high !== undefined && (toFixed(price) < toFixed(s.low) || toFixed(price) > toFixed(s.high));
