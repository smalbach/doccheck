import { normalizeName } from '../normalize';
import type { Rule, RuleResult } from '../types';

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * X11 (US ocean): the ISF filed before loading agrees with the invoice on seller, buyer, country
 * of origin and HTS heading. A mismatch can mean an ISF amendment is due before arrival.
 */
export const x11IsfConsistency: Rule = {
  definition: {
    id: 'X11',
    title: 'ISF agrees with the commercial invoice',
    appliesTo: ['US'],
    requires: ['ISF', 'COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    if (!ctx.isf || !ctx.invoice) return [];
    const isf = ctx.isf.data;
    const inv = ctx.invoice.data;
    const isfId = ctx.isf.id;
    const invId = ctx.invoice.id;
    const results: RuleResult[] = [];

    for (const role of ['seller', 'buyer'] as const) {
      if (normalizeName(isf[role].name) !== normalizeName(inv[role].name)) {
        results.push({
          message: `ISF ${role} is "${isf[role].name}" but the invoice ${role} is "${inv[role].name}".`,
          evidence: [
            { documentId: isfId, field: `${role}.name`, value: isf[role].name },
            { documentId: invId, field: `${role}.name`, value: inv[role].name },
          ],
          suggestedFix: 'Amend the ISF before the vessel arrives if the invoice is right.',
        });
      }
    }

    const origins = [...new Set(inv.lines.map((l) => l.countryOfOrigin).filter((c): c is string => !!c))];
    if (origins.length > 0 && !origins.includes(isf.countryOfOrigin)) {
      results.push({
        message: `ISF country of origin is ${isf.countryOfOrigin}; the invoice states ${origins.join(', ')}.`,
        evidence: [
          { documentId: isfId, field: 'countryOfOrigin', value: isf.countryOfOrigin },
          ...inv.lines.map((l, i) => ({ documentId: invId, field: `lines[${i}].countryOfOrigin`, value: l.countryOfOrigin ?? '' })),
        ],
      });
    }

    const headings = inv.lines.map((l) => (l.hsCode ? digits(l.hsCode).slice(0, 6) : '')).filter(Boolean);
    const isfHeading = digits(isf.htsCode).slice(0, 6);
    if (headings.length > 0 && isfHeading.length === 6 && !headings.includes(isfHeading)) {
      results.push({
        message: `ISF HTS ${isf.htsCode} does not match any HS heading on the invoice (${[...new Set(headings)].join(', ')}).`,
        evidence: [
          { documentId: isfId, field: 'htsCode', value: isf.htsCode },
          ...inv.lines.map((l, i) => ({ documentId: invId, field: `lines[${i}].hsCode`, value: l.hsCode ?? '' })),
        ],
      });
    }
    return results;
  },
};
