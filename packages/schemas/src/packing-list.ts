import { z } from 'zod';
import { Party, Quantity, Weight } from './common';

export const PackageType = z.enum(['CTN', 'PLT', 'BAG', 'CRT', 'DRM', 'OTHER']);

export const PackageGroup = z.object({
  range: z.string(), // "1-60"
  count: z.number().int().positive(),
  type: PackageType,
  marks: z.string().optional(),
  contents: z.array(z.object({ sku: z.string().optional(), description: z.string(), quantity: Quantity, hsCode: z.string().optional() })), // hsCode: when the packing list prints one (rule H3)
  netWeight: Weight.optional(), // per group
  grossWeight: Weight.optional(),
  dimensionsCm: z.tuple([z.number(), z.number(), z.number()]).optional(),
});
export type PackageGroup = z.infer<typeof PackageGroup>;

export const PackingList = z.object({
  packingListNumber: z.string().optional(),
  invoiceRef: z.string().optional(),
  seller: Party.optional(),
  consignee: Party.optional(),
  packages: z.array(PackageGroup).min(1),
  totals: z.object({
    packageCount: z.number().int().nonnegative(),
    netWeight: Weight.optional(),
    grossWeight: Weight.optional(),
    volumeM3: z.string().optional(),
  }),
});
export type PackingList = z.infer<typeof PackingList>;
