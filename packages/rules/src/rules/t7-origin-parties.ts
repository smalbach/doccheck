import type { Evidence, Party } from '@doccheck/schemas';
import { normalizeName } from '../normalize';
import type { Rule, RuleResult, ShipmentContext } from '../types';

const same = (a: Party | undefined, b: Party | undefined) => !!a && !!b && normalizeName(a.name) === normalizeName(b.name);

interface Certificate {
  id: string;
  label: string;
  exporter?: Party;
  /** The party the goods go to: consignee on a chamber certificate, importer on a CUSMA one. */
  receiver?: { field: string; party: Party };
  producer?: Party;
}

function certificates(ctx: ShipmentContext): Certificate[] {
  const out: Certificate[] = [];
  const coo = ctx.certificateOfOrigin;
  if (coo) out.push({ id: coo.id, label: 'certificate of origin', exporter: coo.data.exporter, receiver: coo.data.consignee && { field: 'consignee', party: coo.data.consignee }, producer: coo.data.producer });
  const cusma = ctx.cusmaCertification;
  if (cusma) out.push({ id: cusma.id, label: 'CUSMA certification', exporter: cusma.data.exporter, receiver: cusma.data.importer && { field: 'importer', party: cusma.data.importer }, producer: cusma.data.producer });
  return out;
}

/**
 * T7: the parties on the certificate of origin (chamber of commerce form or CUSMA certification) are
 * the invoice's: exporter = seller (or the invoice's exporter), consignee or importer = buyer or
 * consignee, and, when the US ISF names a manufacturer, producer = manufacturer. A certificate made
 * out to other parties does not cover these goods, and the preference or the origin claim falls.
 * Names compare after the same normalization as X1 (case, punctuation, legal form).
 */
export const t7OriginParties: Rule = {
  definition: {
    id: 'T7',
    title: 'Certificate of origin parties match the invoice',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    requiresAny: ['CERTIFICATE_OF_ORIGIN', 'CUSMA_CERTIFICATION'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    optional: true,
  },
  run(ctx) {
    if (!ctx.invoice) return [];
    const inv = ctx.invoice;
    const results: RuleResult[] = [];
    for (const cert of certificates(ctx)) {
      const sellers = [inv.data.seller, inv.data.exporter].filter((p): p is Party => !!p);
      if (cert.exporter && !sellers.some((p) => same(p, cert.exporter))) {
        results.push({
          message: `The ${cert.label} names exporter "${cert.exporter.name}", but the invoice is issued by "${inv.data.seller.name}".`,
          evidence: [
            { documentId: cert.id, field: 'exporter.name', value: cert.exporter.name },
            { documentId: inv.id, field: 'seller.name', value: inv.data.seller.name },
          ],
          suggestedFix: `Ask the exporter for a ${cert.label} made out by the party that sells and ships these goods.`,
        });
      }
      const receivers = [inv.data.buyer, inv.data.consignee].filter((p): p is Party => !!p);
      if (cert.receiver && !receivers.some((p) => same(p, cert.receiver!.party))) {
        const evidence: Evidence[] = [
          { documentId: cert.id, field: `${cert.receiver.field}.name`, value: cert.receiver.party.name },
          { documentId: inv.id, field: 'buyer.name', value: inv.data.buyer.name },
        ];
        if (inv.data.consignee && !same(inv.data.consignee, inv.data.buyer)) evidence.push({ documentId: inv.id, field: 'consignee.name', value: inv.data.consignee.name });
        results.push({
          message: `The ${cert.label} names ${cert.receiver.field} "${cert.receiver.party.name}", who is neither the buyer nor the consignee on the invoice.`,
          evidence,
          suggestedFix: `Have the ${cert.label} reissued to the importer of these goods.`,
        });
      }
      const manufacturer = ctx.isf?.data.manufacturer;
      if (cert.producer && manufacturer && !same(cert.producer, manufacturer) && !sellers.some((p) => same(p, cert.producer))) {
        results.push({
          severity: 'LOW',
          message: `The ${cert.label} names producer "${cert.producer.name}", but the ISF manufacturer is "${manufacturer.name}".`,
          evidence: [
            { documentId: cert.id, field: 'producer.name', value: cert.producer.name },
            { documentId: ctx.isf!.id, field: 'manufacturer.name', value: manufacturer.name },
          ],
          suggestedFix: 'Confirm who made the goods; the ISF manufacturer and the certificate producer should be the same factory.',
        });
      }
    }
    return results;
  },
};
