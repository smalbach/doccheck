import { isValidGbEori } from '../ids/eori';
import type { Rule } from '../types';
import { importerId } from './importer';

/**
 * K2: the importer's number on the invoice is a UK EORI number: GB (or XI for Northern Ireland)
 * followed by 12 digits. A missing number is K1's finding.
 */
export const k2GbEori: Rule = {
  definition: {
    id: 'K2',
    title: "Importer's EORI number has the UK format",
    appliesTo: ['GB'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    const importer = ctx.invoice && importerId(ctx.invoice.data);
    if (!ctx.invoice || !importer || isValidGbEori(importer.id)) return [];
    return [
      {
        message: `The importer's number "${importer.id}" (${importer.role}) is not a UK EORI number, which has the prefix GB and 12 digits (HMRC EORI manual; CDS DE 3/16).`,
        evidence: [{ documentId: ctx.invoice.id, field: `${importer.role}.taxId`, value: importer.id }],
        suggestedFix: "Check the importer's number with HMRC's 'Check an EORI number' service and ask for a corrected invoice.",
      },
    ];
  },
};
