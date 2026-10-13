import { CLOSING_STATUSES, REVIEW_STATUSES } from './reviews.types';
import { z } from 'zod';
import { BillOfLading, CommercialInvoice, Destination, Isf, PackingList, TransportMode } from '@doccheck/schemas';

export const CreateShipmentDto = z.object({
  reference: z.string().optional(),
  destination: Destination.optional(),
  transportMode: TransportMode.optional(),
});
export type CreateShipmentDto = z.infer<typeof CreateShipmentDto>;

export const UpdateShipmentDto = z
  .object({
    reference: z.string().trim().max(200).nullable().optional(),
    destination: Destination.optional(),
    transportMode: TransportMode.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Send at least one of reference, destination, transportMode');
export type UpdateShipmentDto = z.infer<typeof UpdateShipmentDto>;

export const ListShipmentsQuery = z.object({
  status: z.enum(['all', 'open', 'attention', 'done']).default('all'),
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListShipmentsQuery = z.infer<typeof ListShipmentsQuery>;

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

/** Values corrected by hand: JSON pointers into the normalized document; null removes an optional field. */
export const CorrectDataDto = z
  .object({
    changes: z
      .array(z.object({ path: z.string().max(300), value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]) }).strict())
      .min(1)
      .max(500),
  })
  .strict();
export type CorrectDataDto = z.infer<typeof CorrectDataDto>;

export const ReviewFindingsDto = z
  .object({
    /** Fingerprints of findings of the latest validation run. */
    fingerprints: z.array(z.string().regex(/^[0-9a-f]{32}$/)).min(1).max(200),
    status: z.enum(REVIEW_STATUSES),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((d) => !CLOSING_STATUSES.includes(d.status) || (d.note ?? '').length >= 3, { message: 'Say why: a note is required to accept a finding or mark it a false positive', path: ['note'] });
export type ReviewFindingsDto = z.infer<typeof ReviewFindingsDto>;
