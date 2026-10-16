import { normalizeName } from '../normalize';
import type { Rule } from '../types';

/** "INV-2026/0412" and "inv 2026 0412" are one number. */
const invoiceKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * X17: the invoice number from this seller has not been used on another shipment of the account.
 * The same invoice twice usually means the shipment is declared twice (duties paid twice, or one
 * entry for goods that arrived once), or the shipper reused a number for different goods.
 */
export const x17DuplicateInvoice: Rule = {
  definition: {
    id: 'X17',
    title: 'Invoice number not already used for this seller',
    appliesTo: 'ALL',
    requires: ['COMMERCIAL_INVOICE'],
    kind: 'DETERMINISTIC',
    severity: 'HIGH',
  },
  run(ctx) {
    const prior = ctx.account?.invoices;
    if (!ctx.invoice || !prior?.length) return [];
    const { id, data } = ctx.invoice;
    const number = invoiceKey(data.invoiceNumber);
    const seller = normalizeName(data.seller.name);
    const same = prior.filter(
      (p) => p.shipmentId !== ctx.shipmentId && invoiceKey(p.invoiceNumber) === number && (!p.sellerName || normalizeName(p.sellerName) === seller),
    );
    if (!number || same.length === 0) return [];
    const where = same.map((p) => `shipment ${p.shipmentReference ?? p.shipmentId}${p.invoiceDate ? ` (${p.invoiceDate})` : ''}`).join(', ');
    return [
      {
        message: `Invoice ${data.invoiceNumber} from ${data.seller.name} was already used in ${where}.`,
        evidence: [
          { documentId: id, field: 'invoiceNumber', value: data.invoiceNumber },
          ...same.map((p) => ({ documentId: p.documentId, field: 'invoiceNumber', value: p.invoiceNumber })),
        ],
        suggestedFix: 'Make sure these goods are not declared twice. If the shipper reused the number, ask for a new invoice.',
      },
    ];
  },
};
