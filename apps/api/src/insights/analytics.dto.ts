import { z } from 'zod';
import { Destination } from '@doccheck/schemas';
import { CostAssumptions } from './cost/penalties';

const Day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date as YYYY-MM-DD');

/** Destination and date range (of each shipment's first validation, both days included). */
export const AnalyticsQuery = z
  .object({ destination: Destination.optional(), from: Day.optional(), to: Day.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must not be after to', path: ['from'] });
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export const PricesQuery = z.object({
  destination: Destination.optional(),
  by: z.enum(['product', 'hs6']).default('product'),
  q: z.string().trim().max(200).optional(),
  /** Only groups with at least one outlier. */
  outliers: z.enum(['true', 'false']).optional(),
});
export type PricesQuery = z.infer<typeof PricesQuery>;

export const PriceGroupQuery = z.object({
  destination: Destination.optional(),
  by: z.enum(['product', 'hs6']).default('product'),
  key: z.string().trim().min(1).max(80),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  unit: z.string().trim().max(20).default(''),
});
export type PriceGroupQuery = z.infer<typeof PriceGroupQuery>;

export const AskBody = z.object({ question: z.string().trim().min(3).max(500) });
export type AskBody = z.infer<typeof AskBody>;

/** PUT /analytics/cost/assumptions: the whole table; null goes back to the defaults. */
export const CostAssumptionsBody = z.object({ assumptions: CostAssumptions.nullable() });
export type CostAssumptionsBody = z.infer<typeof CostAssumptionsBody>;
