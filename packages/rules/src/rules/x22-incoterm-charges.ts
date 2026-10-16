import type { Money } from '@doccheck/schemas';
import { toFixed } from '../decimal';
import type { Rule, RuleResult } from '../types';

/** Incoterms 2020 where the buyer pays the main carriage. */
const BUYER_CARRIAGE = new Set(['EXW', 'FCA', 'FAS', 'FOB']);
/** The seller must also insure the goods (Incoterms 2020: CIF minimum ICC (C), CIP ICC (A)). */
const SELLER_INSURES = new Set(['CIF', 'CIP']);
/** The seller pays carriage but the buyer insures. */
const CARRIAGE_ONLY = new Set(['CFR', 'CPT']);

const positive = (m: Money | undefined): m is Money => !!m && toFixed(m.amount) > 0n;

/**
 * X22: the charges the invoice shows agree with its Incoterm (Incoterms 2020). Ocean freight charged
 * to the buyer on an EXW, FCA, FAS or FOB invoice, insurance on a CFR or CPT one, or a CIF/CIP invoice
 * that itemizes freight but no insurance, means the term or the charges are wrong, and the customs
 * value with them: Canada and the US both value goods without the international freight and
 * insurance, so how those are shown decides what is deducted.
 */
export const x22IncotermCharges: Rule = {
  definition: {
    id: 'X22',
    title: 'Invoice charges agree with the Incoterm',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    const inv = ctx.invoice;
    const term = inv?.data.incoterm?.code;
    if (!inv || !term) return [];
    const { freight, insurance } = inv.data.charges ?? {};
    const termEv = { documentId: inv.id, field: 'incoterm.code', value: term };
    const results: RuleResult[] = [];
    if (BUYER_CARRIAGE.has(term) && positive(freight)) {
      results.push({
        severity: term === 'EXW' ? 'MEDIUM' : 'LOW',
        message: `The invoice is ${term}, where the buyer pays the main carriage, yet it charges freight of ${freight.amount} ${freight.currency}.`,
        evidence: [termEv, { documentId: inv.id, field: 'charges.freight.amount', value: freight.amount }],
        suggestedFix:
          term === 'EXW'
            ? 'Under EXW the seller delivers at its premises and charges no transport; ask whether the term should be FCA, CPT or CFR.'
            : `Under ${term} the seller may charge transport up to the port, not the ocean freight; ask what the charge covers and correct the term if it is the main carriage.`,
      });
    }
    if (BUYER_CARRIAGE.has(term) && positive(insurance)) {
      results.push({
        severity: 'LOW',
        message: `The invoice is ${term} but charges insurance of ${insurance.amount} ${insurance.currency}; under ${term} the buyer insures the main carriage.`,
        evidence: [termEv, { documentId: inv.id, field: 'charges.insurance.amount', value: insurance.amount }],
        suggestedFix: 'Ask what the insurance covers; if the seller insured the voyage the term may be CIF or CIP.',
      });
    }
    if (CARRIAGE_ONLY.has(term) && positive(insurance)) {
      results.push({
        severity: 'LOW',
        message: `The invoice is ${term} but charges insurance of ${insurance.amount} ${insurance.currency}; under ${term} insurance is the buyer's.`,
        evidence: [termEv, { documentId: inv.id, field: 'charges.insurance.amount', value: insurance.amount }],
        suggestedFix: `If the seller insured the goods the term is ${term === 'CFR' ? 'CIF' : 'CIP'}; correct the term or remove the charge.`,
      });
    }
    if (SELLER_INSURES.has(term) && positive(freight) && !positive(insurance)) {
      results.push({
        message: `The invoice is ${term} and itemizes freight (${freight.amount} ${freight.currency}) but no insurance, which ${term} requires the seller to buy.`,
        evidence: [termEv, { documentId: inv.id, field: 'charges.insurance', value: (inv.data.charges?.insurance?.amount ?? '') }],
        suggestedFix: `Ask for the insurance amount; without it the ${term} price cannot be reduced to the customs value, or the term is really ${term === 'CIF' ? 'CFR' : 'CPT'}.`,
      });
    }
    return results;
  },
};
