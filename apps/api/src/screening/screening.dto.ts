import { z } from 'zod';

const score = z.number().min(0.5).max(1);

export const ThresholdsDto = z
  .object({ match: score, review: score })
  .refine((t) => t.review <= t.match, { message: 'The review threshold must not be above the match threshold', path: ['review'] });
export type ThresholdsDto = z.infer<typeof ThresholdsDto>;

export const RefreshDto = z.object({ only: z.array(z.string().regex(/^[a-z-]{2,30}$/)).max(10).optional() }).default({});
export type RefreshDto = z.infer<typeof RefreshDto>;

export const SearchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  city: z.string().trim().max(100).optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const AddAllowlistDto = z.object({
  partyName: z.string().trim().min(1).max(300),
  list: z.string().regex(/^[a-z-]{2,30}$/),
  entryId: z.string().min(1).max(200),
  reason: z.string().trim().min(3, 'Say why this is a false positive').max(1000),
});
export type AddAllowlistDto = z.infer<typeof AddAllowlistDto>;

export const RemoveAllowlistDto = z.object({ reason: z.string().trim().max(1000).optional() }).default({});
export type RemoveAllowlistDto = z.infer<typeof RemoveAllowlistDto>;

export const AllowlistQuery = z.object({
  history: z.enum(['true', 'false']).optional(),
  all: z.enum(['true', 'false']).optional(),
});
export type AllowlistQuery = z.infer<typeof AllowlistQuery>;
