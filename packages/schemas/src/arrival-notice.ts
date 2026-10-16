import { z } from 'zod';
import { IsoDate, Location, Money, Party, TransportMode, Weight } from './common';

/** Arrival notice the carrier or forwarder sends the consignee before the goods arrive. */
export const ArrivalNotice = z.object({
  noticeNumber: z.string().optional(),
  carrier: z.object({ name: z.string(), scac: z.string().optional() }).optional(),
  mode: TransportMode.optional(),
  /** The bill of lading or air waybill the notice is for. */
  transportDocumentNumber: z.string().min(1),
  vessel: z.string().optional(),
  voyage: z.string().optional(),
  flight: z.string().optional(),
  portOfLoading: Location.optional(),
  portOfDischarge: Location.optional(),
  estimatedArrival: IsoDate.optional(),
  consignee: Party,
  notifyParty: Party.optional(),
  containers: z.array(z.object({ number: z.string().min(1), seal: z.string().optional(), type: z.string().optional() })).optional(),
  packages: z.number().int().nonnegative().optional(),
  grossWeight: Weight.optional(),
  cargoDescription: z.string().optional(),
  freightTerms: z.enum(['PREPAID', 'COLLECT']).optional(),
  lastFreeDay: IsoDate.optional(),
  charges: z.array(z.object({ description: z.string(), amount: Money })).optional(),
});
export type ArrivalNotice = z.infer<typeof ArrivalNotice>;
