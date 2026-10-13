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
  ...page,
});
export type LinesQuery = z.infer<typeof LinesQuery>;

export const ShipmentDataQuery = z.object({
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional(),
  ...page,
});
export type ShipmentDataQuery = z.infer<typeof ShipmentDataQuery>;
