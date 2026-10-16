import { z } from 'zod';
import { RawParty, RawPlace, RawWeight } from './raw-schemas';

/**
 * Raw schemas for the other freight documents: values as printed, null when not printed, the same
 * contract as raw-schemas.ts. Codes the documents print in several ways (PP/CC, "UN 3480", "PG II",
 * "Class 9") are copied as printed and turned into canonical values by normalize-documents.ts.
 */

const text = z.string().nullable();

export const RawAirport = z.object({
  name: text.describe('Airport or city name as printed'),
  code: text.describe('Three-letter IATA code, only if printed'),
});
export type RawAirport = z.infer<typeof RawAirport>;

export const RawAirWaybill = z.object({
  awbNumber: text.describe('The number of this waybill, as printed at the top (e.g. 176-12345675)'),
  documentTitle: text.describe('e.g. AIR WAYBILL, MASTER AIR WAYBILL, HOUSE AIR WAYBILL'),
  masterAwbNumber: text.describe('On a house waybill: the master (MAWB) number it quotes; otherwise null'),
  carrierName: text.describe('Airline (issuing carrier)'),
  shipper: RawParty,
  consignee: RawParty,
  notifyParty: RawParty.nullable(),
  airportOfDeparture: RawAirport,
  airportOfDestination: RawAirport,
  routing: z.array(z.string()).describe('Airport codes of the routing boxes (to / by first carrier), in order; empty if not printed'),
  flights: z.array(z.object({ flight: text, date: text })).describe('Requested flight / date boxes'),
  pieces: text.describe('No. of pieces'),
  grossWeight: RawWeight.nullable(),
  chargeableWeight: RawWeight.nullable().describe('Only if a chargeable weight is printed'),
  volume: text.describe('Volume in cubic metres, if printed'),
  natureOfGoods: text.describe('Nature and quantity of goods'),
  freightTerms: text.describe('Charges code or words as printed: PP, CC, PREPAID, COLLECT'),
  handlingInformation: text,
  references: z.array(z.string()).describe('Invoice or order numbers quoted on the waybill'),
  placeOfExecution: text,
  executedOn: text.describe('Executed on (date)'),
});
export type RawAirWaybill = z.infer<typeof RawAirWaybill>;

export const RawCertificateOfOrigin = z.object({
  certificateNumber: text,
  issuer: text.describe('Chamber of commerce or authority that certifies the document'),
  exporter: RawParty,
  producer: RawParty.nullable(),
  consignee: RawParty.nullable(),
  countryOfOrigin: text.describe('Only from the box or sentence that states the origin of the goods'),
  transport: text.describe('Means of transport and route'),
  goods: z.array(
    z.object({ itemNo: text, description: text, hsCode: text, quantity: text, unit: text, grossWeight: RawWeight.nullable(), marks: text }),
  ),
  invoiceRefs: z.array(z.string()).describe('Invoice numbers the certificate quotes'),
  placeOfIssue: text,
  dateOfIssue: text,
});
export type RawCertificateOfOrigin = z.infer<typeof RawCertificateOfOrigin>;

export const RawCusmaCertification = z.object({
  certifierRole: text.describe('The box marked for who certifies: importer, exporter or producer; null if none is marked'),
  certifier: RawParty.nullable(),
  exporter: RawParty.nullable(),
  producer: RawParty.nullable().describe('Producer party; if the producer field says "Various" or "Available upon request", put that text in name'),
  importer: RawParty.nullable(),
  goods: z.array(
    z.object({
      description: text,
      hsCode: text.describe('HS tariff classification as printed'),
      originCriterion: text.describe('Origin criterion letter as printed (A, B, C or D)'),
      countryOfOrigin: text,
    }),
  ),
  blanketFrom: text.describe('Blanket period start, only if a blanket period is printed'),
  blanketTo: text,
  signatoryName: text,
  signatoryTitle: text,
  signatureDate: text,
  invoiceRefs: z.array(z.string()),
});
export type RawCusmaCertification = z.infer<typeof RawCusmaCertification>;

export const RawArrivalNotice = z.object({
  noticeNumber: text,
  carrierName: text,
  scac: text,
  mode: text.describe('Ocean or air, if printed'),
  transportDocumentNumber: text.describe('Bill of lading or air waybill number the notice is for'),
  vessel: text,
  voyage: text,
  flight: text,
  portOfLoading: RawPlace.nullable(),
  portOfDischarge: RawPlace.nullable(),
  estimatedArrival: text.describe('ETA'),
  consignee: RawParty,
  notifyParty: RawParty.nullable(),
  containers: z.array(z.object({ number: text, seal: text, type: text })),
  packages: text,
  grossWeight: RawWeight.nullable(),
  cargoDescription: text,
  freightTerms: text,
  lastFreeDay: text,
  charges: z.array(z.object({ description: text, amount: text, currency: text })),
});
export type RawArrivalNotice = z.infer<typeof RawArrivalNotice>;

export const RawWoodPackagingCertificate = z.object({
  certificateNumber: text,
  documentTitle: text.describe('Title as printed, e.g. FUMIGATION CERTIFICATE, HEAT TREATMENT CERTIFICATE, PACKING DECLARATION'),
  statement: text.describe('The sentence that says what was treated or declared, copied as printed'),
  treatment: text.describe('Treatment as printed: HT, heat treatment, MB, methyl bromide fumigation...'),
  ispmMark: text.describe('ISPM 15 mark as printed, e.g. CN-3301 HT'),
  treatmentDate: text,
  issuer: text,
  exporter: RawParty.nullable(),
  consignee: RawParty.nullable(),
  packagingDescription: text,
  containers: z.array(z.string()),
  transportDocumentNumber: text,
  invoiceRef: text,
  dateOfIssue: text,
});
export type RawWoodPackagingCertificate = z.infer<typeof RawWoodPackagingCertificate>;

export const RawDangerousGoods = z.object({
  shipper: RawParty,
  consignee: RawParty.nullable(),
  transportDocumentNumber: text.describe('BL or air waybill number'),
  mode: text,
  regulation: text.describe('IMDG, IATA, TDG or 49 CFR, as printed'),
  items: z.array(
    z.object({
      unNumber: text.describe('UN number as printed, e.g. UN 3480'),
      properShippingName: text,
      hazardClass: text.describe('Class or division as printed'),
      subsidiaryRisk: text,
      packingGroup: text.describe('Packing group as printed (I, II, III), only if printed'),
      quantity: text,
      unit: text,
      packages: text.describe('Number and kind of packages'),
    }),
  ),
  emergencyContact: text,
  signatoryName: text,
  signatoryPlace: text,
  signatureDate: text,
});
export type RawDangerousGoods = z.infer<typeof RawDangerousGoods>;
