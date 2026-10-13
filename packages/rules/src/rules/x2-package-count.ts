import type { Evidence } from '@doccheck/schemas';
import type { Rule } from '../types';

/** X2: number of packages must match across invoice, packing list and BL. */
export const x2PackageCount: Rule = {
  definition: {
    id: 'X2',
    title: 'Package count matches across documents',
    appliesTo: 'ALL',
    requires: ['PACKING_LIST', 'BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    const counts: Evidence[] = [];
    if (ctx.invoice?.data.packageCount !== undefined) {
      counts.push({ documentId: ctx.invoice.id, field: 'packageCount', value: String(ctx.invoice.data.packageCount) });
    }
    if (ctx.packingList) {
      counts.push({ documentId: ctx.packingList.id, field: 'totals.packageCount', value: String(ctx.packingList.data.totals.packageCount) });
    }
    if (ctx.billOfLading) {
      counts.push({ documentId: ctx.billOfLading.id, field: 'totalPackages', value: String(ctx.billOfLading.data.totalPackages) });
    }
    const distinct = new Set(counts.map((c) => c.value));
    if (distinct.size <= 1) return [];
    return [
      {
        message: `Package count differs between documents: ${counts.map((c) => `${c.field}=${c.value}`).join(', ')}.`,
        evidence: counts,
        suggestedFix: 'Confirm the physical count with the shipper and correct the document that is wrong.',
      },
    ];
  },
};
