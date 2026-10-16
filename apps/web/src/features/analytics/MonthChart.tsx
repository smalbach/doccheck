export interface MonthBar {
  /** YYYY-MM. */
  month: string;
  value: number;
  /** The value as people read it ("1.5", "40 %"). */
  label: string;
  /** What the bar's tooltip adds ("12 shipments"). */
  detail?: string;
}

const W = 640;
const H = 200;
const PAD = { top: 14, right: 8, bottom: 26, left: 44 };

/** A rounded top on a bar anchored to the baseline: the data end is rounded, the base is square. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * One measure per month as columns, single hue. Each bar has a tooltip and a hit area taller than
 * the bar; the page puts the same numbers in a table next to it.
 */
export function MonthChart({ bars, ariaLabel, formatMonth, formatValue }: { bars: readonly MonthBar[]; ariaLabel: string; formatMonth: (month: string) => string; formatValue: (v: number) => string }) {
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / bars.length;
  const bw = Math.max(4, Math.min(48, slot - 2 * Math.max(2, slot * 0.15)));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  // Label every month while they fit, else every n-th.
  const every = Math.ceil(bars.length / Math.max(1, Math.floor(plotW / 56)));
  return (
    <svg className="analytics-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {[0, max].map((v) => (
        <g key={v}>
          <line className="analytics-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
          <text className="analytics-chart-axis" x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
            {formatValue(v)}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const x = PAD.left + i * slot + (slot - bw) / 2;
        const h = Math.max(b.value > 0 ? 2 : 0, (b.value / max) * plotH);
        const tip = [formatMonth(b.month), b.label, b.detail].filter(Boolean).join(' · ');
        return (
          <g key={b.month} className="analytics-chart-bar">
            <rect className="analytics-chart-hit" x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH}>
              <title>{tip}</title>
            </rect>
            {h > 0 && <path className="analytics-chart-mark" d={barPath(x, y(0) - h, bw, h)} aria-hidden />}
            {i % every === 0 && (
              <text className="analytics-chart-axis" x={x + bw / 2} y={H - 8} textAnchor="middle" aria-hidden>
                {formatMonth(b.month)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
