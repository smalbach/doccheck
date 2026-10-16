import { z } from 'zod';
import { Address, CountryCode, Location, Party } from './common';

/** Importer Security Filing (10+2): the 10 importer data elements. US ocean only. */
export const Isf = z.object({
  seller: Party,
  buyer: Party,
  importerOfRecordNumber: z.string(),
  consigneeNumber: z.string(),
  manufacturer: Party,
  shipToParty: Party,
  countryOfOrigin: CountryCode,
  htsCode: z.string(),
  containerStuffingLocation: Address,
  consolidator: Party,
  /** When the ISF was filed: an ISO date or date-time ("2026-10-01" or "2026-10-01T14:30:00Z"). */
  filedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
  /** When the cargo is expected to be laden on the vessel at the foreign port, same formats. */
  estimatedLoadingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
  /** Shipment identifiers the filing is made against (house or master BL, booking). */
  blNumber: z.string().optional(),
  bookingNumber: z.string().optional(),
  scac: z.string().optional(),
  portOfLoading: Location.optional(),
  portOfDischarge: Location.optional(),
  /** The two carrier elements (+2), when the filing shows their status. */
  carrierElements: z.object({ vesselStowPlan: z.boolean().optional(), containerStatusMessages: z.boolean().optional() }).optional(),
});
export type Isf = z.infer<typeof Isf>;
