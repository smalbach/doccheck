import { equalRounded, fromFixed, mul, sum, toFixed } from '../decimal';
import type { Rule, RuleResult } from '../types';

/** X5: quantity × unit price = line total, and the sum of lines = invoice total. */
export const x5InvoiceArithmetic: Rule = {
  definition: {
    id: 'X5',
    title: 'Invoice arithmetic is consistent',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    if (!ctx.invoice) return [];
    const { id, data } = ctx.invoice;
    const results: RuleResult[] = [];

    data.lines.forEach((line, i) => {
      const expected = mul(line.quantity.value, line.unitPrice.amount);
      if (!equalRounded(expected, toFixed(line.lineTotal.amount))) {
        results.push({
          message: `Line ${line.lineNo}: ${line.quantity.value} × ${line.unitPrice.amount} = ${fromFixed(expected)}, but the line total says ${line.lineTotal.amount}.`,
          evidence: [
            { documentId: id, field: `lines[${i}].quantity.value`, value: line.quantity.value },
            { documentId: id, field: `lines[${i}].unitPrice.amount`, value: line.unitPrice.amount },
            { documentId: id, field: `lines[${i}].lineTotal.amount`, value: line.lineTotal.amount },
          ],
        });
      }
    });

    const linesTotal = sum(data.lines.map((l) => l.lineTotal.amount));
    if (!equalRounded(linesTotal, toFixed(data.invoiceTotal.amount))) {
      results.push({
        message: `Sum of line totals is ${fromFixed(linesTotal)}, but the invoice total says ${data.invoiceTotal.amount}.`,
        evidence: [{ documentId: id, field: 'invoiceTotal.amount', value: data.invoiceTotal.amount }],
        suggestedFix: 'Check for a missing line, a discount or charges added to the total without being itemized.',
      });
    }
    return results;
  },
};
