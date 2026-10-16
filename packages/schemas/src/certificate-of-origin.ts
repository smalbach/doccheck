import { z } from 'zod';
import { CountryCode, IsoDate, Party, Quantity, Weight } from './common';

/** Six-digit (or longer) tariff classification: "9503.00", "8517.62.00". */
const HsCode = z.string().regex(/^\d{4}(\.?\d{2}){1,3}$/);

/** Certificate of origin issued by a chamber of commerce or a government body (non-preferential or another agreement's form). */
export const CertificateOfOrigin = z.object({
  certificateNumber: z.string().optional(),
  /** Chamber of commerce or authority that certifies it. */
  issuer: z.string().optional(),
  exporter: Party,
  producer: Party.optional(),
  consignee: Party.optional(),
  /** Optional so that a certificate that does not state it still parses and rule T8 can say so. */
  countryOfOrigin: CountryCode.optional(),
  transport: z.string().optional(),
  goods: z
    .array(
      z.object({
        itemNo: z.number().int().positive().optional(),
        description: z.string().min(1),
        hsCode: HsCode.optional(),
        quantity: Quantity.optional(),
        grossWeight: Weight.optional(),
        marks: z.string().optional(),
      }),
    )
    .min(1),
  invoiceRefs: z.array(z.string()).optional(),
  placeOfIssue: z.string().optional(),
  dateOfIssue: IsoDate.optional(),
});
export type CertificateOfOrigin = z.infer<typeof CertificateOfOrigin>;

export const OriginCriterion = z.enum(['A', 'B', 'C', 'D']);

/**
 * CUSMA / USMCA / T-MEC certification of origin. It has no prescribed form: any document with the
 * nine minimum data elements of CUSMA Annex 5-A will do. The numbers are those elements. Most are
 * optional here so that a certification missing one still parses and rule T9 can say which.
 */
export const CusmaCertification = z.object({
  certifierRole: z.enum(['IMPORTER', 'EXPORTER', 'PRODUCER']).optional(), // 1
  certifier: Party.optional(), // 2
  exporter: Party.optional(), // 3 (not required when the producer certifies and does not export)
  producer: Party.optional(), // 4
  /** 4: instead of a producer, "VARIOUS" or "AVAILABLE UPON REQUEST BY THE IMPORTING AUTHORITIES". */
  producerStatement: z.enum(['VARIOUS', 'AVAILABLE_UPON_REQUEST']).optional(),
  importer: Party.optional(), // 5 (if known)
  goods: z
    .array(
      z.object({
        description: z.string().min(1), // 6
        hsCode: HsCode.optional(), // 6: at least six digits
        originCriterion: OriginCriterion.optional(), // 7
        countryOfOrigin: CountryCode.optional(),
      }),
    )
    .min(1),
  blanketPeriod: z.object({ from: IsoDate, to: IsoDate }).optional(), // 8 (only for a blanket certification)
  signature: z.object({ name: z.string().optional(), title: z.string().optional(), date: IsoDate.optional() }).optional(), // 9
  invoiceRefs: z.array(z.string()).optional(),
});
export type CusmaCertification = z.infer<typeof CusmaCertification>;
