import type { InvoiceLine } from '@doccheck/schemas';
import { fromFixed, toFixed } from '../decimal';
import { normalizeName } from '../normalize';
import { canonicalUnit } from '../reference';
import type { PricePoint, Rule, RuleResult } from '../types';

/** How past purchases of a line's product are found: by SKU, else by normalized description. */
export function productKey(line: Pick<InvoiceLine, 'sku' | 'description'>): string | null {
  if (line.sku?.trim()) return `sku:${line.sku.trim().toUpperCase()}`;
  const d = normalizeName(line.description ?? '');
  return d ? `desc:${d}` : null;
}

/** Median of fixed-point values (mean of the two middle ones for an even count). */
export function median(values: bigint[]): bigint {
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2n;
}

/** Median absolute deviation from the median. */
export const mad = (values: bigint[], m = median(values)): bigint => median(values.map((v) => (v > m ? v - m : m - v)));

/** At most this many past prices are cited as evidence (the most recent). */
const MAX_CITED = 12;

/**
 * X23: a unit price far below what the account has paid for the same product before. Past prices in
 * the same currency and unit are summarized with the median and the median absolute deviation (MAD),
 * which a few odd past prices do not move. A price is flagged when it is both a given fraction below
 * the median and far outside the usual spread: robust z = 0.6745 × (median − price) / MAD above the
 * threshold (when every past price is equal, MAD is 0 and the fraction alone decides).
 * Undervaluation is the most common customs valuation problem; the finding lists the series it compared.
 */
export const x23PriceHistory: Rule = {
  definition: {
    id: 'X23',
    title: 'Unit prices in line with the account\'s price history',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    params: [
      { key: 'priceDeviation', unit: 'percent', min: 0.05, max: 0.9 },
      { key: 'priceScore', unit: 'score', min: 1, max: 10 },
      { key: 'priceMinHistory', unit: 'count', min: 3, max: 50 },
    ],
  },
  run(ctx, params) {
    const history = ctx.account?.prices;
    if (!ctx.invoice || !history) return [];
    const { id, data } = ctx.invoice;
    const results: RuleResult[] = [];
    data.lines.forEach((line, i) => {
      const key = productKey(line);
      const unit = canonicalUnit(line.quantity.unit);
      const series: PricePoint[] = (key ? history[key] ?? [] : []).filter(
        (p) => p.shipmentId !== ctx.shipmentId && p.currency === line.unitPrice.currency && (!p.unit || canonicalUnit(p.unit) === unit) && /^\d+(\.\d+)?$/.test(p.unitPrice),
      );
      if (series.length < params.priceMinHistory) return;
      const values = series.map((p) => toFixed(p.unitPrice));
      const m = median(values);
      const spread = mad(values, m);
      const price = toFixed(line.unitPrice.amount);
      // price < m × (1 − deviation), in fixed point (deviation to 6 decimals).
      const dev = BigInt(Math.round(params.priceDeviation * 1_000_000));
      const farBelow = price * 1_000_000n < m * (1_000_000n - dev);
      // 0.6745 × (m − price) / MAD > score  ⇔  (m − price) × 6745 > score × 10000 × MAD.
      const score = BigInt(Math.round(params.priceScore * 1000));
      const outlier = spread === 0n || (m - price) * 6745n * 1000n > score * 10_000n * spread;
      if (!farBelow || !outlier) return;
      const below = Number(((m - price) * 1000n) / m) / 10;
      const cited = [...series].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, MAX_CITED);
      const label = line.sku ? `SKU ${line.sku}` : `line ${line.lineNo}`;
      results.push({
        message: `${label} is invoiced at ${line.unitPrice.amount} ${line.unitPrice.currency} per ${line.quantity.unit}, ${below}% below the median of ${fromFixed(m, 2)} over ${series.length} past purchases (MAD ${fromFixed(spread, 2)}; past prices ${cited.map((p) => p.unitPrice).join(', ')}${series.length > cited.length ? ', …' : ''}).`,
        evidence: [
          { documentId: id, field: `lines[${i}].unitPrice.amount`, value: line.unitPrice.amount },
          ...cited.map((p) => ({ documentId: p.documentId, field: `lines[${p.line}].unitPrice.amount`, value: p.unitPrice })),
        ],
        suggestedFix: 'Ask the seller why the price dropped (discount, quality, assist, related-party price). Customs values the goods at the price actually paid or payable, all adjustments included.',
      });
    });
    return results;
  },
};
