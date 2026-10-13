import { z } from 'zod';

/**
 * What the model returns: values copied as printed ("48,600.00", "14-MAR-2026", "2,756 LB"),
 * null when the document does not show them. No regexes or computed values here: turning
 * printed text into canonical types is deterministic code in normalize.ts, where it can be tested.
 */

const text = z.string().nullable();

export const RawParty = z.object({
  name: text,
  addressLines: z.array(z.string()).describe('Street lines only, without city, region, postal code or country'),
  city: text,
  region: text,
  postalCode: text,
  country: text.describe('Country as printed: ISO code or name'),
  taxId: text,
});
export type RawParty = z.infer<typeof RawParty>;

export const RawPlace = z.object({ name: text.describe('Place name only, without the country'), country: text });
export type RawPlace = z.infer<typeof RawPlace>;

export const RawWeight = z.object({ value: text, unit: text.describe('KG, KGS, LB, LBS...') });
export type RawWeight = z.infer<typeof RawWeight>;

export const RawInvoice = z.object({
  invoiceNumber: text,
  invoiceDate: text,
  poNumber: text,
  seller: RawParty,
  buyer: RawParty,
  consignee: RawParty.nullable().describe('Ship-to / consignee party; null if the invoice does not show one'),
  shipmentDate: text,
  transportMode: text,
  placeOfShipment: RawPlace.nullable(),
  portOfEntry: RawPlace.nullable().describe('Only when the invoice has a field labeled port of entry'),
  incotermCode: text.describe('Three-letter Incoterm, e.g. FOB'),
  incotermPlace: text,
  paymentTerms: text,
  currency: text.describe('Currency of the invoice as printed'),
  countryOfOrigin: text.describe('Country of origin stated once for the whole invoice, if any'),
  lines: z.array(
    z.object({
      lineNo: text,
      sku: text,
      description: text.describe('Goods description only; an HS code, SKU or origin printed in the same cell goes in its own field'),
      quantity: text,
      unit: text,
      unitPrice: text,
      unitPriceCurrency: text.describe('Only if this amount shows its own currency; otherwise null'),
      lineTotal: text,
      lineTotalCurrency: text.describe('Only if this amount shows its own currency; otherwise null'),
      countryOfOrigin: text.describe('Origin printed on this line; null if only stated once for the whole invoice'),
      hsCode: text,
    }),
  ),
  totalPackages: text.describe('Number of packages or cartons shipped (labels like Packages, Colis, PKGS, CTNS); digits only'),
  grossWeight: RawWeight.nullable(),
  netWeight: RawWeight.nullable(),
  invoiceTotal: text,
  invoiceTotalCurrency: text,
  charges: z.array(z.object({ type: z.enum(['freight', 'insurance', 'packing', 'other']), amount: text, currency: text })),
});
export type RawInvoice = z.infer<typeof RawInvoice>;

export const RawPackingList = z.object({
  packingListNumber: text,
  invoiceRef: text,
  seller: RawParty.nullable(),
  consignee: RawParty.nullable(),
  marks: text,
  packages: z.array(
    z.object({
      range: text.describe('Package numbers, e.g. 1-60'),
      count: text,
      packageType: text.describe('CTN, PLT, BAG, CRT, DRM... as printed'),
      sku: text,
      description: text,
      quantity: text,
      unit: text,
      netWeight: RawWeight.nullable(),
      grossWeight: RawWeight.nullable(),
      dimensionsCm: text,
    }),
  ),
  totalPackages: text,
  totalNetWeight: RawWeight.nullable(),
  totalGrossWeight: RawWeight.nullable(),
  totalVolumeM3: text,
});
export type RawPackingList = z.infer<typeof RawPackingList>;

export const RawBillOfLading = z.object({
  blNumber: text,
  documentTitle: text.describe('e.g. BILL OF LADING, SEA WAYBILL'),
  issuer: text.describe('MASTER or HOUSE if printed'),
  bookingNumber: text,
  carrierName: text,
  scac: text,
  shipper: RawParty,
  consignee: RawParty,
  notifyParty: RawParty.nullable(),
  vessel: text.describe('Vessel name; it may wrap onto a second line'),
  voyage: text.describe('Voyage number, usually after a slash: "NAME / 012E" -> "012E"'),
  placeOfReceipt: RawPlace.nullable(),
  portOfLoading: RawPlace,
  portOfDischarge: RawPlace,
  placeOfDelivery: RawPlace.nullable(),
  containers: z.array(
    z.object({ number: text, seal: text, type: text, packages: text, grossWeight: RawWeight.nullable(), volumeM3: text }),
  ),
  totalPackages: text.describe('Number of packages in the cargo section'),
  totalGrossWeight: RawWeight.nullable(),
  marksAndNumbers: text,
  cargoDescription: text,
  freightTerms: text,
  references: z.array(z.string()),
  placeOfIssue: text,
  dateOfIssue: text,
  shippedOnBoardDate: text,
});
export type RawBillOfLading = z.infer<typeof RawBillOfLading>;

/** ISF (10+2) filing confirmation: the ten importer data elements as printed. */
export const RawIsf = z.object({
  importerOfRecordNumber: text.describe('Importer of record number exactly as printed, e.g. 36-412876500'),
  consigneeNumber: text,
  manufacturer: RawParty.nullable().describe('Manufacturer (or supplier)'),
  seller: RawParty.nullable(),
  buyer: RawParty.nullable(),
  shipToParty: RawParty.nullable(),
  containerStuffingLocation: RawParty.nullable().describe('Address where the container was stuffed; name only if a facility name is printed there'),
  consolidator: RawParty.nullable().describe('Consolidator (stuffer)'),
  countryOfOrigin: text,
  htsCode: text.describe('Commodity HTSUS number as printed, e.g. 8481.80'),
});
export type RawIsf = z.infer<typeof RawIsf>;
