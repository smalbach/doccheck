import { einPrefixUnused, importerNumberKind } from '../reference';
import type { Rule, RuleResult } from '../types';

/**
 * U4 (US): the importer of record and consignee numbers on the ISF are in a format CBP accepts:
 * IRS EIN (NN-NNNNNNN), EIN with suffix (NN-NNNNNNNXX), CBP-assigned (YYDDPP-NNNNN) or SSN; and an
 * EIN does not start with a prefix the IRS never assigns. Passport and other foreign numbers are
 * not checked (CBP accepts them with the right qualifier).
 */
export const u4ImporterNumber: Rule = {
  definition: {
    id: 'U4',
    title: 'Importer of record number is in a format CBP accepts',
    appliesTo: ['US'],
    requires: ['ISF'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.isf) return [];
    const { id, data } = ctx.isf;
    const results: RuleResult[] = [];
    const fields = [
      ['importerOfRecordNumber', 'Importer of record number'],
      ['consigneeNumber', 'Consignee number'],
    ] as const;
    for (const [field, label] of fields) {
      const value = data[field]?.trim();
      // Empty is U2's finding; letters mean a passport or foreign ID, which this rule does not judge.
      if (!value || /[A-Z]/i.test(value)) continue;
      const kind = importerNumberKind(value);
      const evidence = [{ documentId: id, field, value }];
      if (!kind) {
        results.push({ message: `${label} "${value}" is not an EIN (NN-NNNNNNN, optionally with a 2-digit suffix), a CBP-assigned number (YYDDPP-NNNNN) or an SSN.`, evidence, suggestedFix: 'Use the number on the importer\'s CBP Form 5106; the ISF is rejected otherwise.' });
      } else if ((kind === 'EIN' || kind === 'EIN_SUFFIX') && einPrefixUnused(value)) {
        results.push({ message: `${label} ${value} starts with ${value.slice(0, 2)}, a prefix the IRS does not assign to EINs; it is probably mistyped.`, evidence, suggestedFix: 'Check the EIN against the importer\'s IRS letter or CBP Form 5106.' });
      }
    }
    return results;
  },
};
