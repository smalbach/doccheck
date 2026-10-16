import { daysBetween } from '../reference';
import type { Rule, RuleResult } from '../types';

/**
 * X16: the dates on the documents are possible. An invoice or an on-board date later than the day
 * of the validation, an on-board date after the vessel's estimated arrival, or an ISF filed after
 * the vessel arrives are typing errors (or a document for another sailing). "Today" is the run's
 * asOf date, so the same documents give the same result when a run is replayed.
 */
export const x16DateOrder: Rule = {
  definition: {
    id: 'X16',
    title: 'Document dates are in a possible order',
    appliesTo: 'ALL',
    requires: [],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    const results: RuleResult[] = [];
    const inv = ctx.invoice;
    const bl = ctx.billOfLading;
    const today = ctx.asOf;
    if (today && inv?.data.invoiceDate && daysBetween(inv.data.invoiceDate, today) > 0) {
      results.push({
        message: `The invoice is dated ${inv.data.invoiceDate}, after today (${today}).`,
        evidence: [{ documentId: inv.id, field: 'invoiceDate', value: inv.data.invoiceDate }],
        suggestedFix: 'An invoice cannot be dated in the future; ask the shipper for the right date.',
      });
    }
    const onBoard = bl?.data.shippedOnBoardDate;
    if (today && bl && onBoard && daysBetween(onBoard, today) > 0) {
      results.push({
        message: `The BL says the goods were shipped on board on ${onBoard}, after today (${today}).`,
        evidence: [{ documentId: bl.id, field: 'shippedOnBoardDate', value: onBoard }],
        suggestedFix: 'A shipped-on-board date records a loading that happened; check the date with the carrier.',
      });
    }
    const eta = bl?.data.estimatedArrivalDate;
    if (bl && onBoard && eta && daysBetween(onBoard, eta) > 0) {
      results.push({
        message: `The BL on-board date ${onBoard} is after the estimated arrival ${eta}.`,
        evidence: [
          { documentId: bl.id, field: 'shippedOnBoardDate', value: onBoard },
          { documentId: bl.id, field: 'estimatedArrivalDate', value: eta },
        ],
        suggestedFix: 'One of the dates is wrong; confirm the sailing with the carrier.',
      });
    }
    const filed = ctx.isf?.data.filedAt;
    if (ctx.isf && filed && bl && eta && daysBetween(filed, eta) > 0) {
      results.push({
        message: `The ISF was filed ${filed.slice(0, 10)}, after the vessel's estimated arrival ${eta}.`,
        evidence: [
          { documentId: ctx.isf.id, field: 'filedAt', value: filed },
          { documentId: bl.id, field: 'estimatedArrivalDate', value: eta },
        ],
        suggestedFix: 'Check the filing date; an ISF after arrival is a violation of 19 CFR 149.2 and the cargo may be held.',
      });
    }
    return results;
  },
};
