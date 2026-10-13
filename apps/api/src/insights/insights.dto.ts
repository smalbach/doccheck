import { z } from 'zod';
import { CountryCode, Destination } from '@doccheck/schemas';

const page = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

export const SummaryQuery = z.object({ destination: Destination.optional() });
export type SummaryQuery = z.infer<typeof SummaryQuery>;

export const LinesQuery = z.object({
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional(),
  origin: CountryCode.optional(),
  /** Digits of an HS code or its start, dots ignored: "9503" matches 9503.00.00. */
  hs: z.string().trim().regex(/^[\d.]{2,13}$/).optional(),
  /** Lines of invoices where this company is the seller or the buyer. */
  party: z.string().uuid().optional(),
  product: z.string().uuid().optional(),
  ...page,
});
export type LinesQuery = z.infer<typeof LinesQuery>;

export const ShipmentDataQuery = z.object({
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional(),
  ...page,
});
export type ShipmentDataQuery = z.infer<typeof ShipmentDataQuery>;

/** The filters of a CSV export: those of the list, without paging. */
export const LinesCsvQuery = LinesQuery.omit({ limit: true, offset: true });
export type LinesCsvQuery = z.infer<typeof LinesCsvQuery>;

export const ShipmentDataCsvQuery = ShipmentDataQuery.omit({ limit: true, offset: true });
export type ShipmentDataCsvQuery = z.infer<typeof ShipmentDataCsvQuery>;

export const PartyRole = z.enum(['supplier', 'customer']);
export type PartyRole = z.infer<typeof PartyRole>;

export const PartiesQuery = z.object({
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional(),
  /** supplier: seller, shipper, exporter, manufacturer; customer: buyer, consignee, notify, ship-to. */
  role: PartyRole.optional(),
  ...page,
});
export type PartiesQuery = z.infer<typeof PartiesQuery>;

export const ProductsQuery = z.object({
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional(),
  origin: CountryCode.optional(),
  hs: z.string().trim().regex(/^[\d.]{2,13}$/).optional(),
  ...page,
});
export type ProductsQuery = z.infer<typeof ProductsQuery>;

/** The destination filter of a party's or a product's page. */
export const EntityQuery = z.object({ destination: Destination.optional() });
export type EntityQuery = z.infer<typeof EntityQuery>;

export const ContainersQuery = z.object({
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional(),
  ...page,
});
export type ContainersQuery = z.infer<typeof ContainersQuery>;
