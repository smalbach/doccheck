import type { Evidence } from '@doccheck/schemas';
import type { Rule, ShipmentContext } from '../types';

/** Packaging made of wood, as the transport documents describe it: "12 WOODEN PALLETS", "TIMBER CRATES", "DUNNAGE". */
const WOOD = /\b(?:WOOD(?:EN)?|TIMBER|LUMBER|PINE)\s+(?:PALLETS?|SKIDS?|CRATES?|CASES?|BOX(?:ES)?|PACKAGING|BOARDS?)\b|\bDUNNAGE\b/i;
/** Statements that the wood is ISPM 15 compliant, printed on the documents themselves. */
const ISPM = /\bISPM[\s-]?15\b|\bIPPC\b|\bHEAT[\s-]TREATED\b|\bHT[\s-]TREATED\b|\bFUMIGATED\b|\bKILN[\s-]DRIED\b/i;

/** Texts about the packaging (not the goods: a wooden toy is not wood packaging), with their field. */
function packagingTexts(ctx: ShipmentContext): { documentId: string; field: string; text: string }[] {
  const out: { documentId: string; field: string; text: string }[] = [];
  const add = (doc: { id: string } | undefined, field: string, text: string | undefined) => doc && text && out.push({ documentId: doc.id, field, text });
  ctx.packingList?.data.packages.forEach((g, i) => add(ctx.packingList, `packages[${i}].marks`, g.marks));
  add(ctx.billOfLading, 'cargoDescription', ctx.billOfLading?.data.cargoDescription);
  add(ctx.billOfLading, 'marksAndNumbers', ctx.billOfLading?.data.marksAndNumbers);
  add(ctx.airWaybill, 'natureOfGoods', ctx.airWaybill?.data.natureOfGoods);
  add(ctx.airWaybill, 'handlingInformation', ctx.airWaybill?.data.handlingInformation);
  add(ctx.arrivalNotice, 'cargoDescription', ctx.arrivalNotice?.data.cargoDescription);
  return out;
}

/**
 * T11: wood packaging the documents declare comes with ISPM 15 evidence: a treatment certificate or
 * declaration, or the documents saying the wood is treated and marked. CFIA (D-98-08) and USDA APHIS
 * (7 CFR 319.40-3) refuse or re-export untreated wood packaging, often with the goods on it. A
 * declaration of no wood packaging that contradicts wooden pallets on the BL is reported too.
 * Pallets and crates of unstated material are not assumed to be wood.
 */
export const t11WoodPackaging: Rule = {
  definition: {
    id: 'T11',
    title: 'Wood packaging comes with ISPM 15 evidence',
    appliesTo: 'ALL',
    requires: [],
    requiresAny: ['PACKING_LIST', 'BILL_OF_LADING', 'AIR_WAYBILL', 'ARRIVAL_NOTICE'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    optional: true,
  },
  run(ctx) {
    const texts = packagingTexts(ctx);
    const wood = texts.filter((t) => WOOD.test(t.text));
    if (!wood.length) return [];
    const evidence: Evidence[] = wood.map((t) => ({ documentId: t.documentId, field: t.field, value: t.text }));
    const cert = ctx.woodPackaging;
    if (cert?.data.kind === 'NO_WOOD_DECLARATION') {
      return [
        {
          message: `The packaging declaration says there is no wood packaging, but the documents declare ${wood[0].text.match(WOOD)![0].toLowerCase()}.`,
          evidence: [...evidence, { documentId: cert.id, field: 'kind', value: cert.data.kind }],
          suggestedFix: 'Ask the shipper which is right; wooden pallets need the ISPM 15 mark and a corrected declaration.',
        },
      ];
    }
    if (cert || texts.some((t) => ISPM.test(t.text))) return [];
    return [
      {
        message: `The documents declare ${wood[0].text.match(WOOD)![0].toLowerCase()}, but nothing shows the wood was treated to ISPM 15 (no treatment certificate or declaration, no ISPM 15 statement).`,
        evidence,
        suggestedFix: 'Ask the shipper to confirm the wood carries the ISPM 15 mark and for the heat-treatment or fumigation certificate.',
      },
    ];
  },
};
