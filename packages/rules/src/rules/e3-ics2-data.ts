import type { Evidence } from '@doccheck/schemas';
import { normalizeAddress } from '../normalize';
import type { Rule, RuleResult } from '../types';

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * E3 (EU ocean): the documents carry the house-level data elements of the ICS2 entry summary
 * declaration, filed before loading for maritime goods (UCC Article 127; Annex B, columns F10-F16): the HS
 * code to six digits for every goods item, and the seller, buyer and consignee with their countries.
 * Like X11 for the ISF, a gap found now avoids a "do not load" message at the port of loading.
 */
export const e3Ics2Data: Rule = {
  definition: {
    id: 'E3',
    title: 'Invoice and BL carry the ICS2 entry summary data',
    appliesTo: ['EU'],
    requires: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
  },
  run(ctx) {
    if (!ctx.invoice || !ctx.billOfLading) return [];
    const inv = ctx.invoice.data;
    const invId = ctx.invoice.id;
    const results: RuleResult[] = [];

    const short = inv.lines.map((l, i) => ({ l, i })).filter(({ l }) => digits(l.hsCode ?? '').length < 6);
    if (short.length > 0) {
      results.push({
        message: `HS code to six digits is missing on ${short.length === inv.lines.length ? 'every invoice line' : `line(s) ${short.map(({ l }) => l.lineNo).join(', ')}`}; ICS2 requires it for every goods item (UCC Annex B D.E. 18 09 056 000).`,
        evidence: short.map(({ l, i }) => ({ documentId: invId, field: `lines[${i}].hsCode`, value: l.hsCode ?? '' })),
        suggestedFix: 'Ask the shipper for the six-digit HS code of each line, and pass it to the carrier or forwarder filing the ENS.',
      });
    }

    // A to-order bill names no consignee; the ENS then carries the notify party in its place.
    const bl = ctx.billOfLading.data;
    const toOrder = /^TO (THE )?ORDER\b/.test(normalizeAddress(bl.consignee.name));
    const consignee = toOrder ? bl.notifyParty : bl.consignee;
    const parties: { label: string; ref: string; documentId: string; path: string; name?: string; country?: string }[] = [
      { label: 'Seller', ref: 'D.E. 13 08 000 000', documentId: invId, path: 'seller', name: inv.seller.name, country: inv.seller.address.country },
      { label: 'Buyer', ref: 'D.E. 13 09 000 000', documentId: invId, path: 'buyer', name: inv.buyer.name, country: inv.buyer.address.country },
      { label: toOrder ? 'Notify party' : 'Consignee', ref: 'D.E. 13 03 000 000', documentId: ctx.billOfLading.id, path: toOrder ? 'notifyParty' : 'consignee', name: consignee?.name, country: consignee?.address.country },
    ];
    for (const p of parties) {
      if (p.name?.trim() && p.country) continue;
      const evidence: Evidence[] = [{ documentId: p.documentId, field: p.name?.trim() ? `${p.path}.address.country` : `${p.path}.name`, value: '' }];
      results.push({
        message: `${p.label} ${p.name?.trim() ? 'country' : 'name and address'} is missing; ICS2 requires the ${p.label.toLowerCase()} with a full address (UCC Annex B ${p.ref}).`,
        evidence,
        suggestedFix: `Ask for documents that state the ${p.label.toLowerCase()}'s full address, country included, before the ENS is filed.`,
      });
    }
    return results;
  },
};
