import { z } from 'zod';
import { CountryCode, IsoDate, Party } from './common';

/**
 * Evidence that wood packaging meets ISPM 15: a fumigation or heat-treatment certificate, a
 * phytosanitary certificate, the exporter's ISPM 15 declaration, or a declaration that the shipment
 * has no wood packaging at all.
 */
export const WoodPackagingCertificate = z.object({
  certificateNumber: z.string().optional(),
  kind: z.enum(['FUMIGATION', 'HEAT_TREATMENT', 'PHYTOSANITARY', 'ISPM15_DECLARATION', 'NO_WOOD_DECLARATION']),
  /** IPPC treatment code: HT heat treatment, MB methyl bromide, DH dielectric heating, SF sulfuryl fluoride. */
  treatment: z.enum(['HT', 'MB', 'DH', 'SF']).optional(),
  /** The ISPM 15 mark as printed on the wood: country, producer registration and treatment ("CN-3301 HT"). */
  ispmMark: z.object({ country: CountryCode, registration: z.string().min(1), treatment: z.string().optional() }).optional(),
  treatmentDate: IsoDate.optional(),
  issuer: z.string().optional(),
  exporter: Party.optional(),
  consignee: Party.optional(),
  packagingDescription: z.string().optional(),
  containers: z.array(z.string()).optional(),
  transportDocumentNumber: z.string().optional(),
  invoiceRef: z.string().optional(),
  dateOfIssue: IsoDate.optional(),
});
export type WoodPackagingCertificate = z.infer<typeof WoodPackagingCertificate>;
