import { withinTolerance } from '../decimal';
import type { Rule } from '../types';

/** X3: gross weight on the packing list must match the BL within a configurable tolerance. */
export const x3GrossWeight: Rule = {
  definition: {
    id: 'X3',
    title: 'Gross weight matches between packing list and BL',
    appliesTo: 'ALL',
    requires: ['PACKING_LIST', 'BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    params: [{ key: 'grossWeightTolerance', unit: 'percent', min: 0, max: 0.2 }],
  },
  run(ctx, params) {
    const pl = ctx.packingList?.data.totals.grossWeight;
    const bl = ctx.billOfLading?.data.totalGrossWeight;
    if (!ctx.packingList || !ctx.billOfLading || !pl || !bl) return [];
    if (withinTolerance(pl.kg, bl.kg, params.grossWeightTolerance)) return [];
    return [
      {
        message: `Gross weight is ${pl.kg} kg on the packing list and ${bl.kg} kg on the BL (tolerance ${params.grossWeightTolerance * 100}%).`,
        evidence: [
          { documentId: ctx.packingList.id, field: 'totals.grossWeight.kg', value: pl.kg },
          { documentId: ctx.billOfLading.id, field: 'totalGrossWeight.kg', value: bl.kg },
        ],
      },
    ];
  },
};
