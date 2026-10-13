import type { Party } from '@doccheck/schemas';
import { normalizeAddress, normalizeName, normalizePostalCode, streetLines } from '../normalize';
import type { Rule, RuleResult } from '../types';

const street = (p: Party) => normalizeAddress(streetLines(p.address).join(' '));
const toOrder = (p: Party) => /^TO (THE )?ORDER\b/.test(normalizeAddress(p.name));

/**
 * X1: the consignee on the invoice and on the BL is the same party at the same address.
 * Only differences that survive normalization (case, punctuation, abbreviations, legal form) are
 * reported; "TO ORDER" bills are skipped. Similar-but-different names go to the agent in phase 4.
 */
export const x1ConsigneeMatch: Rule = {
  definition: {
    id: 'X1',
    title: 'Consignee matches between invoice and BL',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    const inv = ctx.invoice?.data.consignee;
    const bl = ctx.billOfLading?.data.consignee;
    if (!ctx.invoice || !ctx.billOfLading || !inv || !bl || toOrder(bl)) return [];
    const invId = ctx.invoice.id;
    const blId = ctx.billOfLading.id;
    const results: RuleResult[] = [];

    if (normalizeName(inv.name) !== normalizeName(bl.name)) {
      results.push({
        message: `Consignee is "${inv.name}" on the invoice and "${bl.name}" on the BL.`,
        evidence: [
          { documentId: invId, field: 'consignee.name', value: inv.name },
          { documentId: blId, field: 'consignee.name', value: bl.name },
        ],
        suggestedFix: 'Confirm who the consignee is; the BL consignee must match the party clearing the goods.',
      });
      return results;
    }

    const postalDiffers =
      inv.address.postalCode && bl.address.postalCode && normalizePostalCode(inv.address.postalCode) !== normalizePostalCode(bl.address.postalCode);
    if (street(inv) !== street(bl) || postalDiffers || inv.address.country !== bl.address.country) {
      const field = street(inv) !== street(bl) ? 'consignee.address.lines[0]' : postalDiffers ? 'consignee.address.postalCode' : 'consignee.address.country';
      const value = (p: Party) =>
        field === 'consignee.address.lines[0]' ? streetLines(p.address).join(', ') : field === 'consignee.address.postalCode' ? p.address.postalCode ?? '' : p.address.country;
      results.push({
        message: `Consignee ${inv.name} has a different address on the invoice ("${value(inv)}") and on the BL ("${value(bl)}").`,
        evidence: [
          { documentId: invId, field, value: value(inv) },
          { documentId: blId, field, value: value(bl) },
        ],
        suggestedFix: 'Check which address is correct and have the other document amended.',
      });
    }
    return results;
  },
};
