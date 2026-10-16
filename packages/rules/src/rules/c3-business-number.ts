import type { Party } from '@doccheck/schemas';
import { luhnValid, parseBusinessNumber } from '../reference';
import type { Rule, RuleResult } from '../types';

/**
 * C3 (Canada): the importer's Business Number on the invoice is a 15-character BN with an import/export
 * program account: 9 digits whose last is a check digit, "RM" and a 4-digit reference ("123456782RM0001").
 * CBSA releases goods against the RM account; a GST (RT) or payroll (RP) account, or a BN that fails
 * its check digit, is rejected on the B3 / CAD.
 *
 * Only a tax ID that looks like a BN (it starts with 9 digits) is checked: a foreign VAT number on a
 * consignee is not this rule's business.
 */
export const c3BusinessNumber: Rule = {
  definition: {
    id: 'C3',
    title: 'Importer Business Number has a valid RM account',
    appliesTo: ['CA'],
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.invoice) return [];
    const { id, data } = ctx.invoice;
    const results: RuleResult[] = [];
    const seen = new Set<string>();
    const parties: [string, Party | undefined][] = [['consignee', data.consignee], ['buyer', data.buyer]];
    for (const [role, party] of parties) {
      const taxId = party?.taxId?.trim();
      if (!taxId || seen.has(taxId) || !/^\d{9}/.test(taxId.replace(/[\s-]/g, ''))) continue;
      seen.add(taxId);
      const evidence = [{ documentId: id, field: `${role}.taxId`, value: taxId }];
      const bn = parseBusinessNumber(taxId);
      if (!bn) {
        results.push({ message: `The ${role}'s Business Number "${taxId}" is not in the 15-character format (9 digits, program, 4-digit reference).`, evidence, suggestedFix: 'Ask the importer for its import/export account number, as on its CRA confirmation (123456789RM0001).' });
      } else if (!luhnValid(bn.bn9)) {
        results.push({ message: `The ${role}'s Business Number ${bn.bn9} fails its check digit; it is probably mistyped.`, evidence, suggestedFix: 'Compare the number with the importer\'s CRA registration and correct the invoice.' });
      } else if (!bn.program) {
        results.push({ severity: 'LOW', message: `The ${role}'s Business Number ${bn.bn9} has no program account; CBSA needs the import/export account (RM).`, evidence, suggestedFix: `Use ${bn.bn9}RM0001 or the importer's other RM account.` });
      } else if (bn.program !== 'RM') {
        results.push({ message: `The ${role}'s Business Number uses program account ${bn.program}; imports are declared under the RM (import/export) account.`, evidence, suggestedFix: `Replace it with the importer's RM account (${bn.bn9}RM0001 or the one CRA issued).` });
      }
    }
    return results;
  },
};
