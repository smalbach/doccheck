import type { Evidence } from '@doccheck/schemas';
import { fromFixed, toFixed } from '../decimal';
import type { Rule, RuleResult } from '../types';

interface Side {
  total: bigint;
  unit?: string;
  evidence: Evidence[];
}

/**
 * X7: quantities on the invoice match the packing list, per SKU. When either document has no SKUs
 * and both list the same number of items, items are paired in order instead.
 */
export const x7QuantityMatch: Rule = {
  definition: {
    id: 'X7',
    title: 'Invoice quantities match the packing list',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE', 'PACKING_LIST'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    if (!ctx.invoice || !ctx.packingList) return [];
    const inv = ctx.invoice;
    const pl = ctx.packingList;
    const plItems = pl.data.packages.flatMap((g, i) => g.contents.map((c, j) => ({ c, path: `packages[${i}].contents[${j}].quantity.value` })));
    const bySku = inv.data.lines.every((l) => l.sku) && plItems.every((p) => p.c.sku);
    if (!bySku && inv.data.lines.length !== plItems.length) return [];

    const invSide = new Map<string, Side>();
    const plSide = new Map<string, Side>();
    const add = (map: Map<string, Side>, key: string, value: string, unit: string, ev: Evidence) => {
      const s = map.get(key) ?? { total: 0n, unit, evidence: [] };
      s.total += toFixed(value);
      if (s.unit !== unit) s.unit = undefined;
      s.evidence.push(ev);
      map.set(key, s);
    };
    inv.data.lines.forEach((l, i) =>
      add(invSide, bySku ? l.sku!.toUpperCase() : String(i), l.quantity.value, l.quantity.unit, { documentId: inv.id, field: `lines[${i}].quantity.value`, value: l.quantity.value }),
    );
    plItems.forEach((p, i) =>
      add(plSide, bySku ? p.c.sku!.toUpperCase() : String(i), p.c.quantity.value, p.c.quantity.unit, { documentId: pl.id, field: p.path, value: p.c.quantity.value }),
    );

    const results: RuleResult[] = [];
    for (const key of new Set([...invSide.keys(), ...plSide.keys()])) {
      const a = invSide.get(key);
      const b = plSide.get(key);
      const label = bySku ? `SKU ${key}` : `item ${Number(key) + 1}`;
      if (!a || !b) {
        const side = (a ?? b)!;
        results.push({
          message: `${label} appears on the ${a ? 'invoice' : 'packing list'} but not on the ${a ? 'packing list' : 'invoice'}.`,
          evidence: side.evidence,
        });
        continue;
      }
      // Different units (e.g. sets vs pieces) cannot be compared without a conversion factor.
      if (a.unit && b.unit && a.unit !== b.unit) continue;
      if (a.total !== b.total) {
        results.push({
          message: `${label}: ${fromFixed(a.total, 0)} on the invoice, ${fromFixed(b.total, 0)} on the packing list.`,
          evidence: [...a.evidence, ...b.evidence],
          suggestedFix: 'Confirm the quantity actually shipped; the invoice must declare what is in the packages.',
        });
      }
    }
    return results;
  },
};
