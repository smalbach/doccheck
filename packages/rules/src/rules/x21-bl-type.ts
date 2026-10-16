import type { Rule, RuleResult } from '../types';

const TO_ORDER = /^\s*(TO\s+(THE\s+)?ORDER|ORDER\s+OF|TO\s+ORDER)\b|^\s*A\s+L['’]ORDRE\b/i;

/**
 * X21: the BL type agrees with how it is consigned. A BL "to order" is negotiable: it must be an
 * original (a sea waybill cannot be to order), state how many originals make up the full set, and
 * name a notify party (there is no consignee to tell when the goods arrive). A straight BL to a named
 * consignee cannot also be marked to order. A sea waybill has no originals; one that says it has is
 * mislabeled. Hague-Visby art. III(3) and UCP 600 art. 20 on the full set of originals.
 */
export const x21BlType: Rule = {
  definition: {
    id: 'X21',
    title: 'BL type agrees with the consignee (straight or to order)',
    appliesTo: 'ALL',
    requires: ['BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.billOfLading) return [];
    const { id, data: bl } = ctx.billOfLading;
    const results: RuleResult[] = [];
    const named = TO_ORDER.test(bl.consignee.name);
    const toOrder = bl.toOrder ?? named;
    const form = bl.blType?.form;
    const consigneeEv = { documentId: id, field: 'consignee.name', value: bl.consignee.name };

    if (bl.toOrder === false && named) {
      results.push({
        message: `The BL is marked as straight (not negotiable), but its consignee reads "${bl.consignee.name}".`,
        evidence: [consigneeEv, { documentId: id, field: 'toOrder', value: 'false' }],
        suggestedFix: 'Ask the carrier which it is: a to-order BL must be surrendered in original to release the goods.',
      });
    }
    if (toOrder && form === 'SEAWAY') {
      results.push({
        severity: 'HIGH',
        message: 'The BL is consigned to order but issued as a sea waybill; a sea waybill is not negotiable and cannot be to order.',
        evidence: [consigneeEv, { documentId: id, field: 'blType.form', value: form }],
        suggestedFix: 'Ask the carrier to issue it as an original BL, or to name the consignee on the waybill.',
      });
    }
    if (toOrder && form !== 'SEAWAY') {
      if (bl.numberOfOriginals === undefined) {
        results.push({
          severity: 'LOW',
          message: 'The BL is consigned to order but does not state how many originals were issued.',
          evidence: [consigneeEv, { documentId: id, field: 'numberOfOriginals', value: '' }],
          suggestedFix: 'The full set of originals must be surrendered to release the goods; ask the carrier how many there are.',
        });
      }
      if (!bl.notifyParty?.name?.trim()) {
        results.push({
          severity: 'LOW',
          message: 'The BL is consigned to order but names no notify party, so nobody is told when the goods arrive.',
          evidence: [consigneeEv, { documentId: id, field: 'notifyParty', value: '' }],
          suggestedFix: 'Ask the shipper to add the buyer or its broker as notify party.',
        });
      }
    }
    if (form === 'ORIGINAL' && bl.numberOfOriginals === 0) {
      results.push({
        message: 'The BL is an original but states 0 originals issued.',
        evidence: [{ documentId: id, field: 'numberOfOriginals', value: '0' }, { documentId: id, field: 'blType.form', value: form }],
        suggestedFix: 'Check the "number of original Bs/L" box with the carrier.',
      });
    }
    if (form === 'SEAWAY' && (bl.numberOfOriginals ?? 0) > 0) {
      results.push({
        severity: 'LOW',
        message: `The BL is a sea waybill but states ${bl.numberOfOriginals} original(s); a waybill is released without originals.`,
        evidence: [{ documentId: id, field: 'numberOfOriginals', value: String(bl.numberOfOriginals) }, { documentId: id, field: 'blType.form', value: form }],
        suggestedFix: 'Confirm with the carrier whether it is an original BL or a waybill; release depends on it.',
      });
    }
    return results;
  },
};
