import type { Evidence } from '@doccheck/schemas';
import type { Rule } from '../types';

/** T2: the pieces on the air waybill match the package count on the invoice and the packing list (X2 for air). */
export const t2AwbPieces: Rule = {
  definition: {
    id: 'T2',
    title: 'Air waybill pieces match the invoice and packing list',
    appliesTo: 'ALL',
    requires: ['AIR_WAYBILL'],
    requiresAny: ['COMMERCIAL_INVOICE', 'PACKING_LIST'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
    optional: true,
  },
  run(ctx) {
    if (!ctx.airWaybill) return [];
    const counts: Evidence[] = [{ documentId: ctx.airWaybill.id, field: 'pieces', value: String(ctx.airWaybill.data.pieces) }];
    if (ctx.invoice?.data.packageCount !== undefined) counts.push({ documentId: ctx.invoice.id, field: 'packageCount', value: String(ctx.invoice.data.packageCount) });
    if (ctx.packingList) counts.push({ documentId: ctx.packingList.id, field: 'totals.packageCount', value: String(ctx.packingList.data.totals.packageCount) });
    if (new Set(counts.map((c) => c.value)).size <= 1) return [];
    return [
      {
        message: `The air waybill says ${ctx.airWaybill.data.pieces} pieces, but ${counts.slice(1).map((c) => `${c.field}=${c.value}`).join(' and ')}.`,
        evidence: counts,
        suggestedFix: 'Confirm the count with the forwarder (pieces as tendered to the airline) and correct the document that is wrong.',
      },
    ];
  },
};
