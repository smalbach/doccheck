import { z } from 'zod';
import { IsoDate, Party, Quantity, TransportMode } from './common';

/** UN number of a dangerous good: "UN3480". */
export const UnNumber = z.string().regex(/^UN\d{4}$/, 'Expected a UN number like UN3480');

/** Shipper's declaration for dangerous goods (IMDG multimodal form, IATA shipper's declaration, TDG or 49 CFR shipping paper). */
export const DangerousGoodsDeclaration = z.object({
  shipper: Party,
  consignee: Party.optional(),
  /** BL or AWB number the declaration travels with. */
  transportDocumentNumber: z.string().optional(),
  mode: TransportMode.optional(),
  regulation: z.enum(['IMDG', 'IATA', 'TDG', '49CFR']).optional(),
  items: z
    .array(
      z.object({
        unNumber: UnNumber,
        properShippingName: z.string().min(1),
        hazardClass: z.string().regex(/^[1-9](\.[1-6])?$/, 'Expected a hazard class like 3 or 2.1'),
        subsidiaryRisk: z.array(z.string()).optional(),
        packingGroup: z.enum(['I', 'II', 'III']).optional(),
        quantity: Quantity.optional(),
        packages: z.string().optional(),
      }),
    )
    .min(1),
  emergencyContact: z.string().optional(),
  signatory: z.object({ name: z.string().optional(), place: z.string().optional(), date: IsoDate.optional() }).optional(),
});
export type DangerousGoodsDeclaration = z.infer<typeof DangerousGoodsDeclaration>;
