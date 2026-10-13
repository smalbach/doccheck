import { z } from 'zod';
import { BillOfLading, CommercialInvoice, Destination, Isf, PackingList, TransportMode } from '@doccheck/schemas';

export const CreateShipmentDto = z.object({
  reference: z.string().optional(),
  destination: Destination.optional(),
  transportMode: TransportMode.optional(),
});
export type CreateShipmentDto = z.infer<typeof CreateShipmentDto>;

/**
 * Temporary until phases 2-3 (PDF parsing + extraction): accept already-normalized documents as JSON,
 * so the rules can be exercised end to end through the API.
 */
export const ValidateShipmentDto = z.object({
  invoice: CommercialInvoice.optional(),
  packingList: PackingList.optional(),
  billOfLading: BillOfLading.optional(),
  isf: Isf.optional(),
});
export type ValidateShipmentDto = z.infer<typeof ValidateShipmentDto>;

export const ReextractDto = z.object({ type: z.enum(['COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING', 'ISF']) });
export type ReextractDto = z.infer<typeof ReextractDto>;
