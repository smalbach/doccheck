import type { Evidence } from '@doccheck/schemas';
import type { Rule, RuleResult, ShipmentContext } from '../types';

/** "UN 3480", "UN3480", "UN-3480" -> "UN3480". */
const UN = /\bUN[\s-]?(\d{4})\b/gi;

/** Words that make a description hazardous, unless negated ("non-hazardous", "not restricted"). */
const HAZARD_WORDS = /\b(dangerous goods|hazardous|hazmat|flammable|inflammable|corrosive|toxic|explosives?|oxidi[sz]ing|radioactive|compressed gas|aerosols?|lithium[- ](ion|metal)|li-ion|IMDG|class [1-9](\.\d)?)\b/i;
const NEGATED = /\b(non[- ]?(hazardous|dangerous|hazmat|DG)|not (restricted|dangerous|hazardous|regulated)|no dangerous goods)\b/gi;

/** HS headings that are dangerous goods as such: explosives and fireworks, gases, lighter fuel, lithium cells. */
const HAZARD_HS = /^(360[1-4]|3606|2711|850650|850760)/;

interface Mention {
  evidence: Evidence;
  why: string;
}

/** The descriptions on the invoice, packing list, BL and air waybill, with the field each comes from. */
function descriptions(ctx: ShipmentContext): { documentId: string; field: string; text: string; hs?: string }[] {
  const out: { documentId: string; field: string; text: string; hs?: string }[] = [];
  ctx.invoice?.data.lines.forEach((l, i) => out.push({ documentId: ctx.invoice!.id, field: `lines[${i}].description`, text: l.description, hs: l.hsCode }));
  ctx.packingList?.data.packages.forEach((g, i) => g.contents.forEach((c, j) => out.push({ documentId: ctx.packingList!.id, field: `packages[${i}].contents[${j}].description`, text: c.description })));
  if (ctx.billOfLading) out.push({ documentId: ctx.billOfLading.id, field: 'cargoDescription', text: ctx.billOfLading.data.cargoDescription });
  if (ctx.airWaybill) {
    out.push({ documentId: ctx.airWaybill.id, field: 'natureOfGoods', text: ctx.airWaybill.data.natureOfGoods });
    if (ctx.airWaybill.data.handlingInformation) out.push({ documentId: ctx.airWaybill.id, field: 'handlingInformation', text: ctx.airWaybill.data.handlingInformation });
  }
  return out;
}

/** What makes the shipment look like dangerous goods, one mention per description that does. */
export function hazardMentions(ctx: ShipmentContext): Mention[] {
  const mentions: Mention[] = [];
  for (const d of descriptions(ctx)) {
    const text = d.text.replace(NEGATED, ' ');
    const un = [...text.matchAll(UN)].map((m) => `UN${m[1]}`);
    const word = text.match(HAZARD_WORDS)?.[0];
    const hs = d.hs && HAZARD_HS.test(d.hs.replace(/\D/g, '')) ? d.hs : undefined;
    if (!un.length && !word && !hs) continue;
    if (hs && !un.length && !word) mentions.push({ evidence: { documentId: d.documentId, field: d.field.replace(/description$/, 'hsCode'), value: hs }, why: `HS ${hs}` });
    else mentions.push({ evidence: { documentId: d.documentId, field: d.field, value: d.text }, why: un.length ? un.join(', ') : `"${word}"` });
  }
  return mentions;
}

const unNumbers = (ctx: ShipmentContext) => new Map(descriptions(ctx).flatMap((d) => [...d.text.matchAll(UN)].map((m) => [`UN${m[1]}`, d] as const)));

/**
 * T10: goods that the commercial documents describe as dangerous (a UN number, words like
 * "flammable" or "lithium-ion", or an HS heading that is dangerous goods as such) travel with a
 * dangerous goods declaration, and every UN number they quote is on it. Carriers refuse undeclared
 * dangerous goods and both CBSA (TDG) and the US (49 CFR 172) require the shipping paper.
 */
export const t10DangerousGoods: Rule = {
  definition: {
    id: 'T10',
    title: 'Dangerous goods travel with a dangerous goods declaration',
    appliesTo: 'ALL',
    requires: [],
    requiresAny: ['COMMERCIAL_INVOICE', 'PACKING_LIST'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
    optional: true,
  },
  run(ctx) {
    const mentions = hazardMentions(ctx);
    if (!mentions.length) return [];
    const dg = ctx.dangerousGoods;
    if (!dg) {
      return [
        {
          message: `The documents describe dangerous goods (${[...new Set(mentions.map((m) => m.why))].join('; ')}), but there is no dangerous goods declaration.`,
          evidence: mentions.map((m) => m.evidence),
          suggestedFix: "Ask the shipper for the dangerous goods declaration (IMDG or IATA shipper's declaration), or a written statement that the goods are not regulated.",
        },
      ];
    }
    const declared = new Set(dg.data.items.map((i) => i.unNumber));
    const results: RuleResult[] = [];
    for (const [un, d] of unNumbers(ctx)) {
      if (declared.has(un)) continue;
      results.push({
        message: `${un} is quoted on the documents but not on the dangerous goods declaration (${[...declared].join(', ')}).`,
        evidence: [
          { documentId: d.documentId, field: d.field, value: d.text },
          { documentId: dg.id, field: 'items[0].unNumber', value: dg.data.items[0].unNumber },
        ],
        suggestedFix: 'Have the declaration amended so it lists every dangerous good in the shipment.',
      });
    }
    return results;
  },
};
