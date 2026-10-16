import type { Rule } from '../types';

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/**
 * X9: the date of shipment on the invoice (CBSA CI1 field 2, date of direct shipment) is close to
 * the date the BL says the goods were shipped on board. A gap of more than a week usually means the
 * invoice belongs to another sailing, or one of the dates is mistyped.
 */
export const x9ShipmentDate: Rule = {
  definition: {
    id: 'X9',
    title: 'Invoice shipment date matches the BL on-board date',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'LOW',
    params: [{ key: 'shipmentDateDays', unit: 'days', min: 0, max: 60 }],
  },
  run(ctx, params) {
    const shipped = ctx.invoice?.data.shipmentDate;
    const onBoard = ctx.billOfLading?.data.shippedOnBoardDate;
    if (!ctx.invoice || !ctx.billOfLading || !shipped || !onBoard) return [];
    const gap = days(onBoard, shipped);
    if (Math.abs(gap) <= params.shipmentDateDays) return [];
    return [
      {
        message: `The invoice shows shipment on ${shipped}, but the BL was shipped on board on ${onBoard} (${Math.abs(gap)} days ${gap > 0 ? 'later' : 'earlier'}).`,
        evidence: [
          { documentId: ctx.invoice.id, field: 'shipmentDate', value: shipped },
          { documentId: ctx.billOfLading.id, field: 'shippedOnBoardDate', value: onBoard },
        ],
        suggestedFix: 'Confirm both documents refer to the same sailing and correct the wrong date.',
      },
    ];
  },
};
