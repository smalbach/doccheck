import { z } from 'zod';
import { IsoDate, Party, Weight } from './common';

/** IATA airport code: "YVR", "PVG". */
export const IataCode = z.string().regex(/^[A-Z]{3}$/, 'Expected a three-letter IATA code');

export const Airport = z.object({
  name: z.string().min(1),
  iata: IataCode.optional(),
});
export type Airport = z.infer<typeof Airport>;

/**
 * Air waybill number as IATA prints it: the airline's 3-digit prefix, a dash and 8 digits, the
 * last of which is the serial number mod 7 ("176-12345675"). House waybills use the forwarder's own
 * numbering, which has no check digit.
 */
export const AwbNumber = z.string().regex(/^\d{3}-\d{8}$/, 'Expected an air waybill number like 176-12345675');

/** Air waybill, master (MAWB, issued for the airline) or house (HAWB, issued by the forwarder). */
export const AirWaybill = z.object({
  awbNumber: z.string().min(1),
  issuer: z.enum(['MAWB', 'HAWB']).optional(),
  /** On a house waybill: the master it flies under. */
  masterAwbNumber: AwbNumber.optional(),
  carrier: z.object({ name: z.string(), iataPrefix: z.string().regex(/^\d{3}$/).optional() }).optional(),
  shipper: Party,
  consignee: Party,
  notifyParty: Party.optional(),
  airportOfDeparture: Airport,
  airportOfDestination: Airport,
  /** Airports in order, departure and destination included, when the routing is printed. */
  routing: z.array(IataCode).optional(),
  flights: z.array(z.object({ flight: z.string().min(1), date: IsoDate.optional() })).optional(),
  pieces: z.number().int().nonnegative(),
  grossWeight: Weight,
  /** The greater of gross and volumetric weight, which the rate applies to. */
  chargeableWeight: Weight.optional(),
  volumeM3: z.string().optional(),
  natureOfGoods: z.string().min(1),
  freightTerms: z.enum(['PREPAID', 'COLLECT']).optional(),
  handlingInformation: z.string().optional(),
  references: z.array(z.string()).optional(), // invoice or PO numbers quoted on the AWB
  placeOfExecution: z.string().optional(),
  executedOn: IsoDate.optional(),
});
export type AirWaybill = z.infer<typeof AirWaybill>;
