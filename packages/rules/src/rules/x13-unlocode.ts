import { isKnownLocode } from '../reference';
import type { Rule, RuleResult } from '../types';
import { locode, placesOf } from './locations';

/**
 * X13: every UN/LOCODE on the invoice, BL and ISF is in the UNECE code list, and its first two
 * letters are the country the document gives for that place. An unknown code is usually a typo
 * (CNSHA vs CNSHG) and makes the manifest or ISF reject or route the cargo wrongly.
 */
export const x13Unlocode: Rule = {
  definition: {
    id: 'X13',
    title: 'UN/LOCODEs are valid',
    appliesTo: 'ALL',
    requires: [],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    const results: RuleResult[] = [];
    for (const p of placesOf(ctx)) {
      const code = locode(p.place);
      if (!code) continue;
      const evidence = [{ documentId: p.documentId, field: `${p.field}.unLocode`, value: p.place.unLocode! }];
      if (!isKnownLocode(code)) {
        results.push({
          message: `${p.label} ${p.place.name} has UN/LOCODE ${code}, which is not in the UNECE code list.`,
          evidence,
          suggestedFix: 'Look the place up in the UNECE UN/LOCODE list and correct the code on the document.',
        });
      } else if (p.place.country && p.place.country !== code.slice(0, 2)) {
        results.push({
          severity: 'LOW',
          message: `${p.label} ${p.place.name} is given as country ${p.place.country}, but UN/LOCODE ${code} is in ${code.slice(0, 2)}.`,
          evidence: [...evidence, { documentId: p.documentId, field: `${p.field}.country`, value: p.place.country }],
          suggestedFix: 'Correct the code or the country so both name the same place.',
        });
      }
    }
    return results;
  },
};
