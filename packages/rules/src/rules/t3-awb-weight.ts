import { toFixed, withinTolerance } from '../decimal';
import type { Rule, RuleResult } from '../types';

/**
 * T3: the gross weight on the air waybill matches the packing list (and the invoice, when it states
 * one) within the X3 tolerance, and the chargeable weight is not below the gross weight: airlines
 * charge the greater of actual and volumetric weight, so a lower one is a typo or a rating error.
 */
export const t3AwbWeight: Rule = {
  definition: {
    id: 'T3',
    title: 'Air waybill weights agree with the packing list',
    appliesTo: 'ALL',
    requires: ['AIR_WAYBILL'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    optional: true,
  },
  run(ctx, params) {
    if (!ctx.airWaybill) return [];
    const awb = ctx.airWaybill;
    const gross = awb.data.grossWeight;
    const results: RuleResult[] = [];
    const others = [
      ctx.packingList?.data.totals.grossWeight && { documentId: ctx.packingList.id, field: 'totals.grossWeight.kg', kg: ctx.packingList.data.totals.grossWeight.kg, name: 'packing list' },
      ctx.invoice?.data.grossWeight && { documentId: ctx.invoice.id, field: 'grossWeight.kg', kg: ctx.invoice.data.grossWeight.kg, name: 'invoice' },
    ].filter((o): o is { documentId: string; field: string; kg: string; name: string } => !!o);
    const off = others.filter((o) => !withinTolerance(o.kg, gross.kg, params.grossWeightTolerance));
    if (off.length) {
      results.push({
        message: `Gross weight is ${gross.kg} kg on the air waybill and ${off.map((o) => `${o.kg} kg on the ${o.name}`).join(', ')} (tolerance ${params.grossWeightTolerance * 100}%).`,
        evidence: [{ documentId: awb.id, field: 'grossWeight.kg', value: gross.kg }, ...off.map((o) => ({ documentId: o.documentId, field: o.field, value: o.kg }))],
        suggestedFix: 'Check the weight the airline scaled at acceptance and correct the document that is wrong.',
      });
    }
    const chargeable = awb.data.chargeableWeight;
    if (chargeable && toFixed(chargeable.kg) < toFixed(gross.kg)) {
      results.push({
        message: `The chargeable weight (${chargeable.kg} kg) is below the gross weight (${gross.kg} kg) on the air waybill; it should be the greater of gross and volumetric weight.`,
        evidence: [
          { documentId: awb.id, field: 'chargeableWeight.kg', value: chargeable.kg },
          { documentId: awb.id, field: 'grossWeight.kg', value: gross.kg },
        ],
        severity: 'LOW',
        suggestedFix: 'Ask the forwarder to re-rate the air waybill; the freight on the invoice (CIP, CPT) may be wrong too.',
      });
    }
    return results;
  },
};
