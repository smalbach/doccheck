import type { Rule } from '../types';

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** X8: the packing list refers to this invoice. */
export const x8InvoiceReference: Rule = {
  definition: {
    id: 'X8',
    title: 'Packing list refers to the invoice',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE', 'PACKING_LIST'],
    kind: 'DETERMINISTIC',
    severity: 'LOW',
  },
  run(ctx) {
    const ref = ctx.packingList?.data.invoiceRef;
    const number = ctx.invoice?.data.invoiceNumber;
    if (!ctx.invoice || !ctx.packingList || !ref || !number || key(ref) === key(number)) return [];
    return [
      {
        message: `The packing list refers to invoice ${ref}, but the invoice is ${number}.`,
        evidence: [
          { documentId: ctx.packingList.id, field: 'invoiceRef', value: ref },
          { documentId: ctx.invoice.id, field: 'invoiceNumber', value: number },
        ],
        suggestedFix: 'Make sure both documents belong to the same shipment.',
      },
    ];
  },
};
