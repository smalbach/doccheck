import type { Address, Party } from '@doccheck/schemas';
import { normalizeName } from '../normalize';
import type { Rule, RuleResult } from '../types';

/** Values a filer types to get past a required field: they are not data. */
const PLACEHOLDER = /^(N\/?A|NA|NONE|TBA|TBD|UNKNOWN|NIL|-+|\.+|0+|X+)$/i;
const blank = (v: string | undefined) => !v || !v.trim() || PLACEHOLDER.test(v.trim());
const addressBlank = (a: Address | undefined) => !a || (a.lines.every(blank) && blank(a.city));
/** CBP wants a name and an address for each party element (19 CFR 149.3(a)). */
const partyGaps = (p: Party | undefined): string[] => [...(blank(p?.name) ? ['name'] : []), ...(addressBlank(p?.address) ? ['address'] : [])];

/**
 * U2 (US ocean): the ISF has all ten importer elements of 19 CFR 149.3(a), each with a usable value
 * (names with addresses, a 6-digit HTS number, a country code), and where it shows the shipment
 * identifiers and the carrier's two elements (+2: vessel stow plan, container status messages,
 * 19 CFR 149.3(b)), they agree with the BL and are reported as sent.
 */
export const u2IsfCompleteness: Rule = {
  definition: {
    id: 'U2',
    title: 'ISF has all 10+2 elements',
    appliesTo: ['US'],
    requires: ['ISF'],
    kind: 'COMPLETENESS',
    severity: 'HIGH',
  },
  run(ctx) {
    if (!ctx.isf) return [];
    const { id, data: isf } = ctx.isf;
    const results: RuleResult[] = [];
    const missing = (n: number, label: string, field: string, value = '') =>
      results.push({
        message: `ISF element ${n}, ${label}, is missing or not usable (19 CFR 149.3(a)).`,
        evidence: [{ documentId: id, field, value }],
        suggestedFix: 'Amend the ISF with the element before the cargo is loaded; a late or incomplete ISF can cost USD 5,000 in liquidated damages.',
      });
    const parties = [
      [1, 'Seller', 'seller', isf.seller],
      [2, 'Buyer', 'buyer', isf.buyer],
      [5, 'Manufacturer (or supplier)', 'manufacturer', isf.manufacturer],
      [6, 'Ship-to party', 'shipToParty', isf.shipToParty],
      [10, 'Consolidator (stuffer)', 'consolidator', isf.consolidator],
    ] as const;
    for (const [n, label, field, party] of parties) {
      const gaps = partyGaps(party);
      if (gaps.length) missing(n, `${label} ${gaps.join(' and ')}`, gaps[0] === 'name' ? `${field}.name` : `${field}.address`, party?.name ?? '');
    }
    if (blank(isf.importerOfRecordNumber)) missing(3, 'Importer of record number', 'importerOfRecordNumber', isf.importerOfRecordNumber ?? '');
    if (blank(isf.consigneeNumber)) missing(4, 'Consignee number', 'consigneeNumber', isf.consigneeNumber ?? '');
    if (!/^[A-Z]{2}$/.test(isf.countryOfOrigin ?? '')) missing(7, 'Country of origin', 'countryOfOrigin', isf.countryOfOrigin ?? '');
    if ((isf.htsCode ?? '').replace(/\D/g, '').length < 6) missing(8, 'Commodity HTSUS number (at least 6 digits)', 'htsCode', isf.htsCode ?? '');
    if (addressBlank(isf.containerStuffingLocation)) missing(9, 'Container stuffing location', 'containerStuffingLocation', '');

    // Shipment identifiers: an ISF filed against another BL does not cover this cargo.
    const bl = ctx.billOfLading;
    if (bl && isf.blNumber?.trim()) {
      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      // The carrier's SCAC prefix is optional on house bills ("MAEU123" vs "123").
      const a = norm(isf.blNumber);
      const b = norm(bl.data.blNumber);
      if (a !== b && !a.endsWith(b) && !b.endsWith(a)) {
        results.push({
          message: `The ISF is filed against bill ${isf.blNumber}, but this BL is ${bl.data.blNumber}.`,
          evidence: [
            { documentId: id, field: 'blNumber', value: isf.blNumber },
            { documentId: bl.id, field: 'blNumber', value: bl.data.blNumber },
          ],
          suggestedFix: 'Amend the ISF with the right bill number; CBP matches the ISF to the manifest by it.',
        });
      }
    }
    const scac = bl?.data.carrier?.scac;
    if (bl && scac && isf.scac?.trim() && normalizeName(isf.scac) !== normalizeName(scac)) {
      results.push({
        severity: 'MEDIUM',
        message: `The ISF names carrier SCAC ${isf.scac}, the BL ${scac}.`,
        evidence: [
          { documentId: id, field: 'scac', value: isf.scac },
          { documentId: bl.id, field: 'carrier.scac', value: scac },
        ],
        suggestedFix: 'Amend the ISF so the bill is identified with the issuing carrier\'s SCAC.',
      });
    }
    const carrier = isf.carrierElements;
    const plus = [
      ['vesselStowPlan', 'vessel stow plan'],
      ['containerStatusMessages', 'container status messages'],
    ] as const;
    for (const [field, label] of plus) {
      if (carrier?.[field] === false) {
        results.push({
          severity: 'MEDIUM',
          message: `The filing shows the carrier's ${label} as not sent (the "+2" of 19 CFR 149.3(b)).`,
          evidence: [{ documentId: id, field: `carrierElements.${field}`, value: 'false' }],
          suggestedFix: 'Ask the carrier to transmit it; the ISF is not complete until it does.',
        });
      }
    }
    return results;
  },
};
