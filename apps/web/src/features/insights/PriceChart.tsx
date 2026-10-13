import { useI18n } from '../../i18n/useI18n';

export interface PricePointView {
  price: number;
  /** What the point's tooltip says: date, invoice, seller. */
  label: string;
  date?: string;
}

const W = 600;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 64 };

/** Unit price per purchase in one currency, oldest first, as a line. The table below it has the same data. */
export function PriceChart({ points, currency }: { points: readonly PricePointView[]; currency: string }) {
  const { t, formatMoney } = useI18n();
  const head = points[0];
  const tail = points.at(-1);
  if (points.length < 2 || !head || !tail) return null;
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const min = lo - span * 0.1;
  const max = hi + span * 0.1;
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (points.length - 1);
  const y = (v: number) => PAD.top + ((max - v) * (H - PAD.top - PAD.bottom)) / (max - min);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const first = formatMoney(String(head.price), currency);
  const last = formatMoney(String(tail.price), currency);

  return (
    <svg className="price-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('insights.products.detail.chart', { currency, first, last })}>
      {[...new Set([hi, lo])].map((v) => (
        <g key={v}>
          <line className="price-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
          <text className="price-chart-axis" x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
            {formatMoney(String(v), currency)}
          </text>
        </g>
      ))}
      <text className="price-chart-axis" x={PAD.left} y={H - 6}>
        {head.date ?? ''}
      </text>
      <text className="price-chart-axis" x={W - PAD.right} y={H - 6} textAnchor="end">
        {tail.date ?? ''}
      </text>
      <path className="price-chart-line" d={path} />
      {points.map((p, i) => (
        <circle key={i} className="price-chart-dot" cx={x(i)} cy={y(p.price)} r={4}>
          <title>{`${formatMoney(String(p.price), currency)} · ${p.label}`}</title>
        </circle>
      ))}
    </svg>
  );
}
