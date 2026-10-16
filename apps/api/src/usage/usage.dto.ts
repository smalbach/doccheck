import { z } from 'zod';

const Limit = z.number().int().min(0).max(10_000_000).nullable();

export const UpdatePlanDto = z.object({
  name: z.string().trim().min(1).max(40),
  extractionsPerMonth: Limit,
  validationsPerMonth: Limit,
  warnPercent: z.number().int().min(1).max(100),
  enforcement: z.enum(['soft', 'hard']),
});
export type UpdatePlanDto = z.infer<typeof UpdatePlanDto>;

export const SetPlanDto = z.object({ plan: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/) });
export type SetPlanDto = z.infer<typeof SetPlanDto>;

export const CheckoutDto = z.object({ plan: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/) });
export type CheckoutDto = z.infer<typeof CheckoutDto>;
