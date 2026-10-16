import { isValidEuEori } from '../ids/eori';
import type { Rule } from '../types';
import { importerId } from './importer';

/**
 * E2: the importer's number on the invoice is an EORI number valid in the EU (UCC Article 9):
 * a member-state prefix (or XI) and up to 15 letters or digits. A missing number is E1's finding.
 */
export const e2EuEori: Rule = {
  definition: {
    id: 'E2',
    title: "Importer's EORI number is valid in the EU",
    appliesTo: ['EU'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    const importer = ctx.invoice && importerId(ctx.invoice.data);
    if (!ctx.invoice || !importer || isValidEuEori(importer.id)) return [];
    return [
      {
        message: `The importer's number "${importer.id}" (${importer.role}) is not an EU EORI number: it must start with the code of the member state that issued it and have at most 15 characters after it (UCC Article 9; Delegated Regulation 2015/2446, Article 1(18)).`,
        evidence: [{ documentId: ctx.invoice.id, field: `${importer.role}.taxId`, value: importer.id }],
        suggestedFix: "Check the importer's EORI number in the EU EORI validation service and ask for a corrected invoice.",
      },
    ];
  },
};
