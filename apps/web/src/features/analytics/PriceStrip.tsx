import type { PricePoint, PriceStats } from '../../api/analytics';

const W = 640;
const H = 132;
const PAD = { top: 12, right: 16, bottom: 28, left: 16 };
const MID = PAD.top + (H - PAD.top - PAD.bottom) / 2;

export interface PriceStripProps {
  points: readonly PricePoint[];
  stats: PriceStats;
  ariaLabel: string;
  format: (amount: string) => string;
  /** Tooltip text of a point. */
  describe: (p: PricePoint) => string;
}

/**
 * Every unit price of a group on one axis: the middle half (Q1 to Q3) as a band, the median as a
 * line, the normal range (Tukey fences) dashed, prices as dots and outliers as larger diamonds in
 * the warning colour, so they differ by shape as well as colour. Points are spread over a few rows
 * so equal prices stay visible.
 */
export function PriceStrip({ points, stats, ariaLabel, format, describe }: PriceStripProps) {
  if (points.length === 0) return null;
  const nums = points.map((p) => Number(p.unitPrice));
  const lo = Math.min(...nums, Number(stats.low ?? stats.min));
  const hi = Math.max(...nums, Number(stats.high ?? stats.max));
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const min = Math.max(0, lo - span * 0.05);
  const max = hi + span * 0.05;
  const x = (v: number) => PAD.left + ((v - min) * (W - PAD.left - PAD.right)) / (max - min);
  const fence = (v: string | undefined) => (v !== undefined && Number(v) >= min && Number(v) <= max ? x(Number(v)) : undefined);
  const q1 = x(Number(stats.q1));
  const q3 = x(Number(stats.q3));
  const median = x(Number(stats.median));
  const low = fence(stats.low);
  const high = fence(stats.high);
  return (
    <svg className="analytics-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      <line className="analytics-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} />
      <rect className="price-strip-band" x={q1} y={PAD.top} width={Math.max(2, q3 - q1)} height={H - PAD.top - PAD.bottom} rx={4} />
      <line className="price-strip-median" x1={median} x2={median} y1={PAD.top} y2={H - PAD.bottom} />
      {[low, high].map((f, i) => f !== undefined && <line key={i} className="price-strip-fence" x1={f} x2={f} y1={PAD.top} y2={H - PAD.bottom} />)}
      {points.map((p, i) => {
        const cx = x(Number(p.unitPrice));
        const cy = MID + ((i % 5) - 2) * 12;
        return (
          <g key={i}>
            <title>{describe(p)}</title>
            <circle className="analytics-chart-hit" cx={cx} cy={cy} r={10} />
            {p.outlier ? (
              <path className="price-strip-outlier" d={`M${cx},${cy - 7}L${cx + 7},${cy}L${cx},${cy + 7}L${cx - 7},${cy}Z`} />
            ) : (
              <circle className="price-strip-dot" cx={cx} cy={cy} r={4.5} />
            )}
          </g>
        );
      })}
      <text className="analytics-chart-axis" x={PAD.left} y={H - 8}>
        {format(String(min))}
      </text>
      {median - PAD.left > 90 && W - PAD.right - median > 90 && (
        <text className="analytics-chart-axis" x={median} y={H - 8} textAnchor="middle">
          {format(stats.median)}
        </text>
      )}
      <text className="analytics-chart-axis" x={W - PAD.right} y={H - 8} textAnchor="end">
        {format(String(max))}
      </text>
    </svg>
  );
}
