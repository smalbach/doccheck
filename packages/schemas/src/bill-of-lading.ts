import { z } from 'zod';
import { IsoDate, Location, Party, Weight } from './common';

/** ISO 6346 container number: 4 letters + 7 digits (last one is the check digit). */
export const ContainerNumber = z.string().regex(/^[A-Z]{3}[UJZ][0-9]{7}$/, 'Expected ISO 6346 container number');

export const Container = z.object({
  number: ContainerNumber,
  seal: z.string().optional(),
  type: z.string().optional(), // "40HC", "20GP"
  packages: z.number().int().nonnegative().optional(),
  grossWeight: Weight.optional(),
  volumeM3: z.string().optional(),
});
export type Container = z.infer<typeof Container>;

export const BillOfLading = z.object({
  blNumber: z.string().min(1),
  blType: z.object({ issuer: z.enum(['MBL', 'HBL']), form: z.enum(['ORIGINAL', 'SEAWAY']) }).optional(),
  bookingNumber: z.string().optional(),
  carrier: z.object({ name: z.string(), scac: z.string().optional() }).optional(),
  shipper: Party,
  consignee: Party,
  notifyParty: Party.optional(),
  vessel: z.string().optional(),
  voyage: z.string().optional(),
  placeOfReceipt: Location.optional(),
  portOfLoading: Location,
  portOfDischarge: Location,
  placeOfDelivery: Location.optional(),
  containers: z.array(Container),
  totalPackages: z.number().int().nonnegative(),
  totalGrossWeight: Weight,
  marksAndNumbers: z.string().optional(),
  cargoDescription: z.string(),
  freightTerms: z.enum(['PREPAID', 'COLLECT']).optional(),
  placeOfIssue: z.string().optional(),
  dateOfIssue: IsoDate.optional(),
  shippedOnBoardDate: IsoDate.optional(),
  references: z.array(z.string()).optional(), // invoice or PO numbers quoted on the BL
});
export type BillOfLading = z.infer<typeof BillOfLading>;
