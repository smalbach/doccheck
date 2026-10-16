import type { CommercialInvoice, Party } from '@doccheck/schemas';

/**
 * The party whose customs number the invoice should show as importer: the buyer, or the consignee
 * when only the consignee carries one (a buyer abroad ships to an importer of record).
 */
export function importerId(inv: CommercialInvoice): { role: 'buyer' | 'consignee'; party: Party; id: string } | undefined {
  for (const role of ['buyer', 'consignee'] as const) {
    const party = inv[role];
    const id = party?.taxId?.trim();
    if (party && id) return { role, party, id };
  }
  return undefined;
}
