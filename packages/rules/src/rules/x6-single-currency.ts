import type { Evidence } from '@doccheck/schemas';
import type { Rule } from '../types';

/** X6: every amount on the invoice uses the declared currency of settlement. */
export const x6SingleCurrency: Rule = {
  definition: {
    id: 'X6',
    title: 'Invoice uses a single currency',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.invoice) return [];
    const { id, data } = ctx.invoice;
    const mismatches: Evidence[] = [];
    const checkMoney = (field: string, currency?: string) => {
      if (currency && currency !== data.currency) mismatches.push({ documentId: id, field, value: currency });
    };
    data.lines.forEach((l, i) => {
      checkMoney(`lines[${i}].unitPrice.currency`, l.unitPrice.currency);
      checkMoney(`lines[${i}].lineTotal.currency`, l.lineTotal.currency);
    });
    checkMoney('invoiceTotal.currency', data.invoiceTotal.currency);
    checkMoney('charges.freight.currency', data.charges?.freight?.currency);
    checkMoney('charges.insurance.currency', data.charges?.insurance?.currency);
    checkMoney('charges.packing.currency', data.charges?.packing?.currency);
    if (mismatches.length === 0) return [];
    return [
      {
        message: `Invoice currency is ${data.currency}, but ${mismatches.length} amount(s) use another currency.`,
        evidence: [{ documentId: id, field: 'currency', value: data.currency }, ...mismatches],
      },
    ];
  },
};
