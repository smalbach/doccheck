import type { Evidence } from '@doccheck/schemas';
import { fromFixed, toFixed, withinTolerance } from '../decimal';
import { normalizeName } from '../normalize';
import { canonicalUnit, unitRatio } from '../reference';
import type { PurchaseOrder, Rule, RuleResult } from '../types';

const poKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, '');
const lineKey = (l: { sku?: string; description?: string }) => (l.sku?.trim() ? `sku:${l.sku.trim().toUpperCase()}` : `desc:${normalizeName(l.description ?? '')}`);

/** Quantity of a PO line in the invoice's unit, or null when the units do not convert. */
function inUnit(quantity: string, from: string | undefined, to: string): bigint | null {
  if (!from || canonicalUnit(from) === canonicalUnit(to)) return toFixed(quantity);
  const r = unitRatio(from, to);
  return r ? (toFixed(quantity) * r[0]) / r[1] : null;
}

/**
 * X24: three-way match against a purchase order the account imported. The invoice must quote a PO
 * number on file; each invoice line must be on that PO, with the quantity and unit price within the
 * account's tolerances; and the packing list (what was packed) must not exceed what was ordered.
 * Runs only when the account has imported purchase orders.
 */
export const x24PurchaseOrder: Rule = {
  definition: {
    id: 'X24',
    title: 'Invoice matches the purchase order (three-way match)',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    params: [
      { key: 'poQuantityTolerance', unit: 'percent', min: 0, max: 0.5 },
      { key: 'poPriceTolerance', unit: 'percent', min: 0, max: 0.5 },
    ],
  },
  run(ctx, params) {
    const orders = ctx.account?.purchaseOrders ?? [];
    if (!ctx.invoice || (orders.length === 0 && !ctx.account?.purchaseOrderCount)) return [];
    const { id, data } = ctx.invoice;
    if (!data.poNumber?.trim()) {
      return [
        {
          severity: 'LOW',
          message: 'The invoice quotes no purchase order number, so it cannot be matched to an order.',
          evidence: [{ documentId: id, field: 'poNumber', value: '' }],
          suggestedFix: 'Ask the seller to quote the PO number on the invoice.',
        },
      ];
    }
    const po: PurchaseOrder | undefined = orders.find((o) => poKey(o.poNumber) === poKey(data.poNumber!));
    const poNumberEv: Evidence = { documentId: id, field: 'poNumber', value: data.poNumber };
    if (!po) {
      return [
        {
          message: `The invoice quotes PO ${data.poNumber}, which is not among the account's purchase orders.`,
          evidence: [poNumberEv],
          suggestedFix: 'Import the purchase order, or check the number with the buyer: goods invoiced against an unknown order were not ordered.',
        },
      ];
    }
    const poDoc = `po:${po.id}`;
    const results: RuleResult[] = [];
    if (po.currency && po.currency !== data.currency) {
      results.push({
        message: `The invoice is in ${data.currency}, purchase order ${po.poNumber} in ${po.currency}.`,
        evidence: [{ documentId: id, field: 'currency', value: data.currency }, { documentId: poDoc, field: 'currency', value: po.currency }],
        suggestedFix: 'Confirm the currency of the sale with the seller.',
      });
    }
    const poLines = new Map(po.lines.map((l, i) => [lineKey(l), { l, i }]));
    const qtyTol = params.poQuantityTolerance;
    const priceTol = params.poPriceTolerance;
    data.lines.forEach((line, i) => {
      const label = line.sku ? `SKU ${line.sku}` : `line ${line.lineNo}`;
      const match = poLines.get(lineKey(line));
      if (!match) {
        results.push({
          message: `${label} (${line.description}) is invoiced but not on purchase order ${po.poNumber}.`,
          evidence: [poNumberEv, { documentId: id, field: `lines[${i}].${line.sku ? 'sku' : 'description'}`, value: line.sku ?? line.description }],
          suggestedFix: 'Goods that were not ordered may be refused; ask the buyer whether they were added to the order.',
        });
        return;
      }
      const { l: ordered, i: j } = match;
      const qty = inUnit(ordered.quantity, ordered.unit, line.quantity.unit);
      if (qty !== null && !withinTolerance(line.quantity.value, fromFixed(qty, 6), qtyTol)) {
        results.push({
          message: `${label}: ${line.quantity.value} ${line.quantity.unit} invoiced, ${ordered.quantity} ${ordered.unit ?? line.quantity.unit} ordered on PO ${po.poNumber} (tolerance ${qtyTol * 100}%).`,
          evidence: [{ documentId: id, field: `lines[${i}].quantity.value`, value: line.quantity.value }, { documentId: poDoc, field: `lines[${j}].quantity`, value: ordered.quantity }],
          suggestedFix: 'Check with the buyer whether the order was changed; a short or over shipment should be invoiced as such.',
        });
      }
      if (ordered.unitPrice && (!po.currency || po.currency === line.unitPrice.currency) && !withinTolerance(line.unitPrice.amount, ordered.unitPrice, priceTol)) {
        results.push({
          message: `${label}: unit price ${line.unitPrice.amount} on the invoice, ${ordered.unitPrice} on PO ${po.poNumber} (tolerance ${priceTol * 100}%).`,
          evidence: [{ documentId: id, field: `lines[${i}].unitPrice.amount`, value: line.unitPrice.amount }, { documentId: poDoc, field: `lines[${j}].unitPrice`, value: ordered.unitPrice }],
          suggestedFix: 'The customs value is the price actually paid; find out which price is right before the entry.',
        });
      }
    });

    // Third leg: what was packed must not exceed what was ordered (same SKU, same unit).
    const pl = ctx.packingList;
    if (pl) {
      const packed = new Map<string, { total: bigint; unit: string; evidence: Evidence[] }>();
      pl.data.packages.forEach((g, gi) =>
        g.contents.forEach((c, ci) => {
          if (!c.sku) return;
          const k = lineKey(c);
          const e = packed.get(k) ?? { total: 0n, unit: c.quantity.unit, evidence: [] };
          if (canonicalUnit(e.unit) !== canonicalUnit(c.quantity.unit)) return;
          e.total += toFixed(c.quantity.value);
          e.evidence.push({ documentId: pl.id, field: `packages[${gi}].contents[${ci}].quantity.value`, value: c.quantity.value });
          packed.set(k, e);
        }),
      );
      for (const [k, p] of packed) {
        const match = poLines.get(k);
        if (!match) continue;
        const ordered = inUnit(match.l.quantity, match.l.unit, p.unit);
        if (ordered === null) continue;
        const limit = ordered + (ordered * BigInt(Math.round(qtyTol * 1_000_000))) / 1_000_000n;
        if (p.total > limit) {
          results.push({
            message: `${k.replace(/^sku:/, 'SKU ')}: ${fromFixed(p.total, 0)} ${p.unit} packed, more than the ${match.l.quantity} ordered on PO ${po.poNumber}.`,
            evidence: [...p.evidence, { documentId: poDoc, field: `lines[${match.i}].quantity`, value: match.l.quantity }],
            suggestedFix: 'Goods shipped beyond the order may not be paid for or may need a separate invoice; confirm with the buyer.',
          });
        }
      }
    }
    return results;
  },
};
