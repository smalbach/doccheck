import type { Rule } from '../types';

/** Incoterms where the seller contracts and pays the main carriage, so the BL is usually freight prepaid. */
const SELLER_PAYS_CARRIAGE = new Set(['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
/** Incoterms where the buyer pays the main carriage, so the BL is usually freight collect. */
const BUYER_PAYS_CARRIAGE = new Set(['EXW', 'FCA', 'FAS', 'FOB']);

/**
 * X12: the terms of sale on the invoice agree with the freight terms on the BL. A CIF invoice with a
 * freight-collect BL often means freight is paid twice or the declared value is wrong. It can be
 * legitimate (the parties agreed otherwise), hence low severity and the wording.
 */
export const x12IncotermFreight: Rule = {
  definition: {
    id: 'X12',
    title: 'Terms of sale agree with the BL freight terms',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'LOW',
  },
  run(ctx) {
    const incoterm = ctx.invoice?.data.incoterm?.code;
    const freight = ctx.billOfLading?.data.freightTerms;
    if (!ctx.invoice || !ctx.billOfLading || !incoterm || !freight) return [];
    const expected = SELLER_PAYS_CARRIAGE.has(incoterm) ? 'PREPAID' : BUYER_PAYS_CARRIAGE.has(incoterm) ? 'COLLECT' : null;
    if (!expected || expected === freight) return [];
    return [
      {
        message: `The invoice is ${incoterm}, which usually means freight ${expected.toLowerCase()}, but the BL says freight ${freight.toLowerCase()}.`,
        evidence: [
          { documentId: ctx.invoice.id, field: 'incoterm.code', value: incoterm },
          { documentId: ctx.billOfLading.id, field: 'freightTerms', value: freight },
        ],
        suggestedFix: `Check who paid the ocean freight. If it is included in the invoice price (${incoterm}), it may need to be deducted or declared.`,
      },
    ];
  },
};
