import { z } from 'zod';

export const ReviewQueueQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuery>;

export const AcceptFieldsDto = z.object({ paths: z.array(z.string().regex(/^(\/[^/]*)+$/).max(300)).min(1).max(500) });
export type AcceptFieldsDto = z.infer<typeof AcceptFieldsDto>;
