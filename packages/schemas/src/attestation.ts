import { z } from 'zod';

/**
 * Whether a page shows a handwritten signature or a stamp, found by the layout check in
 * packages/extraction (ink that is not text near a signature label; coloured ink for a stamp).
 * Kept beside the extracted data: it is about the paper, not about what the paper says.
 */
export const Attestation = z.object({
  signature: z.boolean(),
  stamp: z.boolean(),
  /** Where the signature or stamp was seen, to cite it. */
  page: z.number().int().positive().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** Whether the page has a place to sign at all (a signature label). */
  signatureBlock: z.boolean().optional(),
});
export type Attestation = z.infer<typeof Attestation>;
