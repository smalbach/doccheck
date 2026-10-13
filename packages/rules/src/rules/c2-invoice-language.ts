import { PROFILES } from '../profiles';
import type { Rule } from '../types';

/** C2: the invoice is in a language the destination accepts (CBSA: English or French). */
export const c2InvoiceLanguage: Rule = {
  definition: {
    id: 'C2',
    title: 'Invoice is in an accepted language',
    appliesTo: ['CA'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'COMPLETENESS',
    severity: 'MEDIUM',
  },
  run(ctx) {
    const lang = ctx.invoice?.data.language;
    const allowed = PROFILES[ctx.destination].allowedInvoiceLanguages;
    // Unknown language is not a finding: extraction does not detect it yet.
    if (!ctx.invoice || !lang || allowed.includes(lang)) return [];
    return [
      {
        message: `The invoice is in "${lang}"; ${PROFILES[ctx.destination].authority} accepts ${allowed.join(' or ')}.`,
        evidence: [{ documentId: ctx.invoice.id, field: 'language', value: lang }],
        suggestedFix: 'Request a translation of the invoice into an accepted language.',
      },
    ];
  },
};
