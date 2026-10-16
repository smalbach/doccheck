import { compactRfc, rfcCheckDigit, rfcProblem } from '../ids/rfc';
import type { Rule } from '../types';
import { importerId } from './importer';

const PROBLEM = {
  format: 'does not have the shape of an RFC (3 or 4 letters, a YYMMDD date, then 3 characters)',
  date: 'contains a date that does not exist',
  check_digit: 'fails the check digit',
} as const;

/**
 * M2: the importer's RFC printed on the invoice is well formed: shape, date and SAT check digit.
 * A missing RFC is M1's finding, not this one. The generic RFCs SAT publishes are accepted.
 */
export const m2MxRfc: Rule = {
  definition: {
    id: 'M2',
    title: "Importer's RFC is valid (format and check digit)",
    appliesTo: ['MX'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    const importer = ctx.invoice && importerId(ctx.invoice.data);
    if (!ctx.invoice || !importer) return [];
    const rfc = importer.id;
    const problem = rfcProblem(rfc);
    if (!problem) return [];
    const compact = compactRfc(rfc);
    const expected = problem === 'check_digit' ? ` (expected ${rfcCheckDigit(compact.slice(0, -1))} as the last character)` : '';
    return [
      {
        message: `The importer's RFC "${rfc}" ${PROBLEM[problem]}${expected}; the value data of the pedimento must carry the consignee's RFC (RGCE regla 1.9.19, fracción I, inciso d).`,
        evidence: [{ documentId: ctx.invoice.id, field: `${importer.role}.taxId`, value: rfc }],
        suggestedFix: "Check the RFC against the importer's Constancia de Situación Fiscal and ask for a corrected invoice.",
      },
    ];
  },
};
