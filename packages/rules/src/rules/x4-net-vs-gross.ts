import { toFixed } from '../decimal';
import type { RuleResult, Rule } from '../types';
import type { Weight } from '@doccheck/schemas';

const check = (documentId: string, prefix: string, net?: Weight, gross?: Weight): RuleResult[] => {
  if (!net || !gross || toFixed(net.kg) <= toFixed(gross.kg)) return [];
  return [
    {
      message: `Net weight (${net.kg} kg) is greater than gross weight (${gross.kg} kg).`,
      evidence: [
        { documentId, field: `${prefix}netWeight.kg`, value: net.kg },
        { documentId, field: `${prefix}grossWeight.kg`, value: gross.kg },
      ],
    },
  ];
};

/** X4: net weight can never exceed gross weight. */
export const x4NetVsGross: Rule = {
  definition: {
    id: 'X4',
    title: 'Net weight is not greater than gross weight',
    appliesTo: 'ALL',
    requires: [],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    const results: RuleResult[] = [];
    if (ctx.invoice) results.push(...check(ctx.invoice.id, '', ctx.invoice.data.netWeight, ctx.invoice.data.grossWeight));
    if (ctx.packingList) {
      const t = ctx.packingList.data.totals;
      results.push(...check(ctx.packingList.id, 'totals.', t.netWeight, t.grossWeight));
    }
    return results;
  },
};
