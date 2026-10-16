import type { Evidence } from '@doccheck/schemas';
import { fromFixed, toFixed } from '../decimal';
import { unitName, unitRatio } from '../reference';
import type { Rule, RuleResult } from '../types';

interface Entry {
  value: string;
  unit: string;
  evidence: Evidence;
}

/** Sum of the entries in `unit`, or null when one of them does not convert to it. */
function total(entries: Entry[], unit: string): bigint | null {
  let acc = 0n;
  for (const e of entries) {
    const r = unitRatio(e.unit, unit);
    if (!r) return null;
    acc += (toFixed(e.value) * r[0]) / r[1];
  }
  return acc;
}

/** Up to 3 decimals, without trailing zeros: "5760", "2.5". */
const show = (v: bigint) => fromFixed(v, 3).replace(/\.?0+$/, '');

/**
 * X18: each SKU is counted in the same unit on the invoice and the packing list, or in units that
 * convert exactly (dozens and pieces, kg and lb, m and ft). Converted quantities must agree; units
 * that do not convert (sets vs pieces, cartons vs pieces) leave the quantity unchecked, so they are
 * reported. Complements X7, which compares quantities only when the printed units are identical.
 */
export const x18UnitsOfMeasure: Rule = {
  definition: {
    id: 'X18',
    title: 'Units of measure agree per SKU between invoice and packing list',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE', 'PACKING_LIST'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.invoice || !ctx.packingList) return [];
    const inv = ctx.invoice;
    const pl = ctx.packingList;
    const plItems = pl.data.packages.flatMap((g, i) => g.contents.map((c, j) => ({ c, i, j })));
    const bySku = inv.data.lines.every((l) => l.sku) && plItems.every((p) => p.c.sku);
    if (!bySku && inv.data.lines.length !== plItems.length) return [];

    const invSide = new Map<string, Entry[]>();
    const plSide = new Map<string, Entry[]>();
    const push = (m: Map<string, Entry[]>, k: string, e: Entry) => m.set(k, [...(m.get(k) ?? []), e]);
    inv.data.lines.forEach((l, i) =>
      push(invSide, bySku ? l.sku!.toUpperCase() : String(i), { value: l.quantity.value, unit: l.quantity.unit, evidence: { documentId: inv.id, field: `lines[${i}].quantity.unit`, value: l.quantity.unit } }),
    );
    plItems.forEach(({ c, i, j }, n) =>
      push(plSide, bySku ? c.sku!.toUpperCase() : String(n), { value: c.quantity.value, unit: c.quantity.unit, evidence: { documentId: pl.id, field: `packages[${i}].contents[${j}].quantity.unit`, value: c.quantity.unit } }),
    );

    const results: RuleResult[] = [];
    for (const [key, a] of invSide) {
      const b = plSide.get(key);
      if (!b) continue; // X7 reports items on one document only.
      const units = new Set([...a, ...b].map((e) => e.unit));
      if (units.size === 1) continue; // Same printed unit: X7 compares the quantities.
      const label = bySku ? `SKU ${key}` : `item ${Number(key) + 1}`;
      const unit = a[0].unit;
      const ta = total(a, unit);
      const tb = total(b, unit);
      const evidence = [...a, ...b].map((e) => e.evidence);
      const printed = (es: Entry[]) => [...new Set(es.map((e) => e.unit))].join(' / ');
      if (ta === null || tb === null) {
        results.push({
          message: `${label} is counted in ${printed(a)} on the invoice and ${printed(b)} on the packing list; these units do not convert, so the quantities cannot be compared.`,
          evidence,
          suggestedFix: 'Ask the shipper to state both documents in the same unit, or to give the conversion (e.g. pieces per set).',
        });
      } else if (ta !== tb) {
        results.push({
          severity: 'HIGH',
          message: `${label}: ${show(ta)} ${unitName(unit)} on the invoice, ${show(tb)} ${unitName(unit)} on the packing list after converting ${printed(b)} to ${printed(a)}.`,
          evidence,
          suggestedFix: 'Confirm the quantity actually shipped; the invoice must declare what is in the packages.',
        });
      }
    }
    return results;
  },
};
