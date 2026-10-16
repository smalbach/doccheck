import { z } from 'zod';

const Email = z.string().trim().toLowerCase().email('Not an email address').max(254);
const Days = z.coerce.number().int().min(1).max(90);

/** A pre-shipment check: the supplier uploads draft documents before shipping and sees the findings. */
export const NewPreShipmentDto = z
  .object({
    partyId: z.string().uuid().optional(),
    /** The supplier's name when it is not a company of the account yet. */
    supplierName: z.string().trim().min(1).max(200).optional(),
    reference: z.string().trim().min(1).max(120),
    destination: z.enum(['CA', 'US']),
    language: z.enum(['en', 'es', 'fr']).default('en'),
    to: z.array(Email).min(1, 'Add a recipient').max(10),
    cc: z.array(Email).max(10).default([]),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(50_000),
    days: Days.optional(),
  })
  .refine((d) => d.partyId || d.supplierName, { message: 'Pick the supplier company, or write its name', path: ['supplierName'] });
export type NewPreShipmentDto = z.infer<typeof NewPreShipmentDto>;

export const NewLinkDto = z.object({ days: Days.optional() });
export type NewLinkDto = z.infer<typeof NewLinkDto>;

export const RevokeDto = z.object({ linkId: z.string().uuid().optional() });
export type RevokeDto = z.infer<typeof RevokeDto>;

export const CloseDto = z.object({ closed: z.boolean() });
export type CloseDto = z.infer<typeof CloseDto>;

export const RequestsQuery = z.object({
  partyId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  shipmentId: z.string().uuid().optional(),
  kind: z.enum(['correction', 'pre_shipment']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RequestsQuery = z.infer<typeof RequestsQuery>;

/** What a supplier may write with an upload. */
export const UploadNote = z.string().trim().max(5000).optional();
