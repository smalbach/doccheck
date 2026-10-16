import { z } from 'zod';
import { CountryCode, CurrencyCode, Incoterm, IsoDate, Location, Money, Party, Quantity, TransportMode, Weight } from './common';

/**
 * One line of the commercial invoice.
 * CA = field number on CBSA form CI1; US = paragraph of 19 CFR 141.86.
 */
export const InvoiceLine = z.object({
  lineNo: z.number().int().positive(),
  sku: z.string().optional(),
  description: z.string().min(1), // CA 12 · US (a)(3)
  marksAndNumbers: z.string().optional(), // CA 12 · US (a)(3)
  quantity: Quantity, // CA 13 · US (a)(4)
  unitPrice: Money, // CA 14 · US (a)(5)
  lineTotal: Money, // CA 15
  countryOfOrigin: CountryCode.optional(), // CA 7 · US (a)(10)
  hsCode: z.string().regex(/^\d{4}(\.?\d{2}){0,3}$/).optional(), // needed for ISF and US entry
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const CommercialInvoice = z.object({
  invoiceNumber: z.string().min(1), // CA 3
  invoiceDate: IsoDate.optional(), // US (a)(2)
  poNumber: z.string().optional(),
  seller: Party, // CA 1 · US (a)(2)
  buyer: Party, // CA 5 · US (a)(2)
  consignee: Party.optional(), // CA 4
  exporter: Party.optional(), // CA 19
  originator: Party.optional(), // CA 20
  shipmentDate: IsoDate.optional(), // CA 2
  portOfEntry: Location.optional(), // US (a)(1)
  transport: z.object({ mode: TransportMode, placeOfShipment: Location.optional() }).optional(), // CA 8
  countryOfTransshipment: CountryCode.optional(), // CA 6
  incoterm: z.object({ code: Incoterm, place: z.string() }).optional(), // CA 9
  paymentTerms: z.string().optional(), // CA 9
  currency: CurrencyCode, // CA 10 · US (a)(5)
  packageCount: z.number().int().nonnegative().optional(), // CA 11
  lines: z.array(InvoiceLine).min(1), // CA 12-15 · US (a)(3)-(5)
  grossWeight: Weight.optional(), // CA 16
  netWeight: Weight.optional(), // CA 16
  invoiceTotal: Money, // CA 17
  charges: z
    .object({ freight: Money.optional(), insurance: Money.optional(), packing: Money.optional() })
    .optional(), // CA 22-25 · US (a)(8)
  discounts: z.array(z.object({ description: z.string(), amount: Money })).optional(), // US (g)
  responsiblePerson: z.string().optional(), // US (j)
  customsRuling: z.string().optional(), // CA 21
  language: z.string().optional(), // detected language: CA allows en/fr, US en, MX es/en/fr
  /** Statement on origin printed on the invoice (UK-EU TCA preference). Not extracted from PDFs yet. */
  originStatement: z.string().optional(), // GB K3
});
export type CommercialInvoice = z.infer<typeof CommercialInvoice>;
