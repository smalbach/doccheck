import type { Evidence } from '@doccheck/schemas';
import { normalizeName } from '../normalize';
import type { Rule, RuleResult } from '../types';
import { locode, placesOf, type NamedPlace } from './locations';

const key = (p: NamedPlace) => locode(p.place) ?? `name:${normalizeName(p.place.name)}`;
const show = (p: NamedPlace) => (locode(p.place) ? `${p.place.name} (${locode(p.place)})` : p.place.name);
const cite = (p: NamedPlace): Evidence => ({
  documentId: p.documentId,
  field: locode(p.place) ? `${p.field}.unLocode` : `${p.field}.name`,
  value: locode(p.place) ?? p.place.name,
});

/**
 * X14: the ports agree across documents. The invoice's place of direct shipment is the BL port of
 * loading (or its place of receipt), the US invoice's port of entry is the BL port of discharge or
 * place of delivery, and the ISF names the same ports as the BL. Places are compared by UN/LOCODE
 * when both have one, otherwise by normalized name.
 */
export const x14PortCoherence: Rule = {
  definition: {
    id: 'X14',
    title: 'Ports agree across invoice, BL and ISF',
    appliesTo: 'ALL',
    requires: ['BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.billOfLading) return [];
    const places = placesOf(ctx);
    const find = (documentId: string | undefined, field: string) => places.find((p) => p.documentId === documentId && p.field === field);
    const blId = ctx.billOfLading.id;
    const results: RuleResult[] = [];
    /** `subject` must equal one of `targets` (those present); one finding citing all of them otherwise. */
    const check = (subject: NamedPlace | undefined, targets: (NamedPlace | undefined)[], what: string, fix: string) => {
      const present = targets.filter((t): t is NamedPlace => !!t);
      if (!subject || present.length === 0) return;
      // A name compared with a code proves nothing; only compare like with like.
      const comparable = present.filter((t) => !!locode(t.place) === !!locode(subject.place));
      if (comparable.length === 0 || comparable.some((t) => key(t) === key(subject))) return;
      results.push({
        message: `${what}: ${subject.label} is ${show(subject)}, but ${comparable.map((t) => `${t.label} is ${show(t)}`).join(' and ')}.`,
        evidence: [cite(subject), ...comparable.map(cite)],
        suggestedFix: fix,
      });
    };
    const pol = find(blId, 'portOfLoading');
    const pod = find(blId, 'portOfDischarge');
    const delivery = find(blId, 'placeOfDelivery');
    const receipt = find(blId, 'placeOfReceipt');
    check(find(ctx.invoice?.id, 'transport.placeOfShipment'), [pol, receipt], 'Place of loading differs', 'Confirm where the goods were loaded; the invoice must show the place of direct shipment the BL shows.');
    check(find(ctx.invoice?.id, 'portOfEntry'), [pod, delivery], 'Port of entry differs', 'The port of entry on the invoice must be where the goods arrive; correct the invoice or the BL.');
    check(find(ctx.isf?.id, 'portOfLoading'), [pol], 'ISF port of loading differs', 'Amend the ISF before the vessel arrives if the BL is right.');
    check(find(ctx.isf?.id, 'portOfDischarge'), [pod], 'ISF port of discharge differs', 'Amend the ISF before the vessel arrives if the BL is right.');
    return results;
  },
};
