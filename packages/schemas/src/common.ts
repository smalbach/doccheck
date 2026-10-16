import { z } from 'zod';

/** Decimal number kept as a string to avoid floating point errors: "12500.00". */
export const Decimal = z.string().regex(/^-?\d+(\.\d+)?$/, 'Expected a decimal string like "12500.00"');

/** ISO 3166-1 alpha-2 country code: "CN", "CA", "US". */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'Expected ISO 3166-1 alpha-2');

/** ISO 4217 currency code: "USD", "CAD". */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'Expected ISO 4217');

/** UN/LOCODE without the space: "CNSHA", "USLAX". */
export const UnLocode = z.string().regex(/^[A-Z]{2}[A-Z2-9]{3}$/, 'Expected UN/LOCODE');

/** ISO 8601 date: "2026-10-01". */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const DocumentType = z.enum([
  'COMMERCIAL_INVOICE',
  'PACKING_LIST',
  'BILL_OF_LADING',
  'ISF',
  'AIR_WAYBILL',
  'CERTIFICATE_OF_ORIGIN',
  'CUSMA_CERTIFICATION',
  'ARRIVAL_NOTICE',
  'WOOD_PACKAGING_CERTIFICATE',
  'DANGEROUS_GOODS_DECLARATION',
  'UNKNOWN',
]);
export type DocumentType = z.infer<typeof DocumentType>;

/** Import destination: a customs regime. EU is the customs union (one Union Customs Code), GB the United Kingdom. */
export const Destination = z.enum(['CA', 'US', 'MX', 'EU', 'GB']);
export type Destination = z.infer<typeof Destination>;

export const TransportMode = z.enum(['SEA', 'AIR', 'ROAD']);
export type TransportMode = z.infer<typeof TransportMode>;

export const Incoterm = z.enum(['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
export type Incoterm = z.infer<typeof Incoterm>;

/**
 * Where a value was found in the source document. Every finding must cite one. In a spreadsheet,
 * `page` is the sheet's position (1-based), `sheet` its name and `cell` the A1 reference ("C12").
 */
export const SourceRef = z.object({
  documentId: z.string(),
  page: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  rawText: z.string(),
  sheet: z.string().optional(),
  cell: z.string().regex(/^[A-Z]{1,3}\d+$/).optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const MissingReason = z.enum(['not_found', 'illegible', 'not_applicable']);

/** Wraps any extracted value with its provenance and confidence. */
export const extracted = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    source: SourceRef.nullable(),
    confidence: z.number().min(0).max(1),
    missingReason: MissingReason.optional(),
  });

export const Money = z.object({ amount: Decimal, currency: CurrencyCode });
export type Money = z.infer<typeof Money>;

export const Quantity = z.object({ value: Decimal, unit: z.string().min(1) });
export type Quantity = z.infer<typeof Quantity>;

/** Weight normalized to kilograms, keeping the original value and unit. */
export const Weight = z.object({ kg: Decimal, raw: Quantity });
export type Weight = z.infer<typeof Weight>;

export const Address = z.object({
  lines: z.array(z.string()),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  /** Absent when the document does not show it legibly (a scan can lose the country line). */
  country: CountryCode.optional(),
});
export type Address = z.infer<typeof Address>;

export const Party = z.object({
  name: z.string().min(1),
  address: Address,
  taxId: z.string().optional(),
  contact: z
    .object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional() })
    .optional(),
});
export type Party = z.infer<typeof Party>;

export const Location = z.object({
  name: z.string().min(1),
  unLocode: UnLocode.optional(),
  /** Absent when the document does not show it (or the model drops it with the UN/LOCODE). */
  country: CountryCode.optional(),
});
export type Location = z.infer<typeof Location>;
