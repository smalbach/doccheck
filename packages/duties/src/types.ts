import { z } from 'zod';
import type { AirWaybill, BillOfLading, CommercialInvoice, CusmaCertification, Destination, Evidence, PackingList, Severity, TransportMode } from '@doccheck/schemas';
import type { Citation } from './citations';
import type { TableMeta } from './tables';

/** The documents of one shipment the estimate reads (same shape as the rule engine's context). */
export interface DutyContext {
  shipmentId: string;
  destination: Destination;
  reference?: string;
  transportMode?: TransportMode;
  invoice?: { id: string; data: CommercialInvoice };
  packingList?: { id: string; data: PackingList };
  billOfLading?: { id: string; data: BillOfLading };
  /** Air shipments: dates, airports and the waybill number (it prints no freight amount). */
  airWaybill?: { id: string; data: AirWaybill };
  /** CUSMA certification of origin uploaded with the shipment: its data elements count for a CUSMA claim. */
  cusmaCertification?: { id: string; data: CusmaCertification };
}

/** The nine minimum data elements of a CUSMA certification of origin (Annex 5-A). */
export const CUSMA_ELEMENTS = [
  'certifierRole',
  'certifier',
  'exporter',
  'producer',
  'importer',
  'descriptionAndHs',
  'originCriterion',
  'blanketPeriod',
  'signatureAndDate',
] as const;
export type CusmaElement = (typeof CUSMA_ELEMENTS)[number];

const Amount = z.string().regex(/^\d+(\.\d+)?$/, 'Expected a decimal string like "1250.00"');
const Money = z.object({ amount: Amount, currency: z.string().regex(/^[A-Z]{3}$/) });
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * What the documents do not say and the user can answer. Every field is optional: an unanswered
 * question becomes a finding, never a guess. Amounts are in the currency given.
 */
export const DutyInputs = z.object({
  /** Date the rates must be in force on (entry / release). Defaults to today. */
  entryDate: IsoDate.optional(),
  /** CA: province of the consignee, when the documents do not show it (ON, QC, BC...). */
  province: z.string().regex(/^[A-Z]{2}$/).optional(),
  /** Buyer and seller related (19 CFR 152.102(g); Customs Act s. 45(3)). */
  relatedParty: z.boolean().optional(),
  /** Assists supplied by the buyer free or at reduced cost; "0" = none. */
  assists: Money.optional(),
  /** Royalties or licence fees paid as a condition of sale; "0" = none. */
  royalties: Money.optional(),
  /**
   * International freight. Under C and D terms: the part of the price that is freight, when the
   * invoice does not show it. Under E and F terms: what the buyer pays, for the landed cost.
   */
  freight: Money.optional(),
  insurance: Money.optional(),
  /** CA, EXW or inland FCA: transport to the place of direct shipment (added to the value for duty). */
  inlandFreight: Money.optional(),
  /** Customs broker, for the landed cost. */
  brokerage: Money.optional(),
  /** Exchange rate overrides: units of the destination currency per 1 unit of each currency. */
  exchangeRates: z.record(z.string().regex(/^[A-Z]{3}$/), Amount).optional(),
  /** Preferential treatment claimed for the shipment. */
  preference: z
    .object({
      agreement: z.string().min(1),
      /** CUSMA: which of the nine data elements the certification of origin has. */
      certification: z.partialRecord(z.enum(CUSMA_ELEMENTS), z.boolean()).optional(),
      /** Other agreements: the proof of origin is on file. */
      proofOnFile: z.boolean().optional(),
    })
    .optional(),
  /** Full tariff number per invoice line number (8-10 digits), when the invoice prints only 6. */
  tariffNumbers: z.record(z.string().regex(/^\d+$/), z.string().regex(/^\d{4}\.?\d{2}(\.?\d{2}){0,2}$/)).optional(),
  /** Value of the steel or aluminium content per invoice line number (Section 232). */
  metalContent: z.record(z.string().regex(/^\d+$/), Money).optional(),
});
export type DutyInputs = z.infer<typeof DutyInputs>;

/** Finding codes of the duty estimate (separate from the validation rules X1-X12, C1, C2, U1). */
export const DUTY_FINDINGS = {
  D1: 'Freight or insurance included in the price but not shown separately',
  D2: 'Transport to the place of direct shipment not on the invoice',
  D3: 'Related buyer and seller',
  D4: 'Assists, royalties or licence fees',
  D5: 'Tariff line not determined',
  D6: 'Exchange rate not found',
  D7: 'Preferential treatment claimed without complete proof of origin',
  D8: 'Possible savings under a trade agreement',
  D9: 'Antidumping, countervailing or SIMA case may apply',
  D10: 'Additional duties to confirm',
  D11: 'Quantity for a specific duty rate missing',
  D12: 'Excise duty or tax may apply',
  D13: 'Country of origin missing on a line',
  D14: 'Province of the consignee unknown',
} as const;
export type DutyFindingCode = keyof typeof DUTY_FINDINGS;

export interface DutyFinding {
  code: DutyFindingCode;
  title: string;
  severity: Severity;
  message: string;
  suggestedFix?: string;
  evidence: Evidence[];
  regulation?: Citation;
  /** The input that answers it, so the web can focus the field. */
  asks?: keyof DutyInputs;
  lineNo?: number;
}

export interface Adjustment {
  kind: 'deduct-freight' | 'deduct-insurance' | 'add-packing' | 'add-inland-freight' | 'add-assists' | 'add-royalties';
  /** In the destination currency. */
  amount: string;
  /** As given (document or input), before conversion. */
  original: { amount: string; currency: string };
  from: 'invoice' | 'input';
  note: string;
}

export interface AppliedAdditional {
  id: string;
  program: string;
  heading?: string;
  /** Effective percent on the line (topUpTo resolved). */
  percent: string;
  base: string;
  amount: string;
  basis: 'value' | 'metalContent';
  verified: boolean;
  source: string;
}

export interface TreatmentOption {
  agreement: string;
  /** CA tariff treatment ("CPTPT") or US program ("S"). */
  treatment: string;
  rate: string;
  duty?: string;
  saving?: string;
}

export interface LineEstimate {
  lineNo: number;
  index: number;
  description: string;
  sku?: string;
  origin?: string;
  quantity: { value: string; unit: string };
  /** HS as printed on the invoice (or entered). */
  hsInput?: string;
  tariff?: {
    code: string;
    classification?: string;
    description: string;
    match: 'exact' | 'single' | 'several' | 'none';
    candidates?: { code: string; rate: string }[];
    units: string[];
  };
  /** Treatment applied: CA "MFN"/"UST"/..., US "general" or a program code. */
  treatment: { code: string; name: string; cadCode?: string; agreement?: string };
  rate?: string;
  /** Line price as invoiced, in the invoice currency. */
  invoiced: { amount: string; currency: string };
  /** Value for duty (CA, cents) or entered value (US, whole dollars), destination currency. */
  dutiableValue: string;
  duty?: string;
  additional: AppliedAdditional[];
  additionalTotal: string;
  fees: string;
  taxes: string;
  selfAssessedTaxes: string;
  goods: string;
  freight: string;
  insurance: string;
  other: string;
  landedCost?: string;
  options: TreatmentOption[];
  adcvd: string[];
  netKg?: string;
}

export interface FeeLine {
  code: 'MPF' | 'HMF';
  name: string;
  base: string;
  percent: string;
  amount: string;
  note?: string;
  source: string;
}

export interface TaxLine {
  code: 'GST' | 'HST' | 'PST';
  name: string;
  base: string;
  percent: string;
  amount?: string;
  /** Collected by CBSA at release; otherwise self-assessed or provincial. */
  atBorder: boolean;
  note?: string;
  source: string;
}

export interface DutyTotals {
  /** Destination currency. */
  currency: string;
  invoiced: string;
  dutiableValue: string;
  duty: string;
  additional: string;
  fees: string;
  taxesAtBorder: string;
  selfAssessedTaxes: string;
  /** Duty + additional + fees + taxes collected at the border. */
  payableAtBorder: string;
  goods: string;
  freight: string;
  insurance: string;
  other: string;
  landedCost: string;
  /** False when a line's duty could not be computed: the totals then leave it out. */
  complete: boolean;
}

export interface DutyEstimate {
  shipmentId: string;
  destination: Destination;
  currency: string;
  entryDate: string;
  generatedAt: string;
  status: 'ok' | 'partial' | 'unavailable';
  /** Why there is no estimate (no invoice, no exchange rate for its currency). */
  unavailableReason?: string;
  invoice?: { documentId: string; number: string; currency: string; incoterm?: string; incotermPlace?: string; total: string };
  exchange: { from: string; to: string; rate: string; published: string; direction: string; date: string; requestedDate: string; source: string; manual?: boolean }[];
  valuation: {
    method: string;
    basis: string;
    incoterm?: string;
    chargesOnInvoice: 'separate' | 'included' | 'none';
    priceInvoiced: string;
    adjustments: Adjustment[];
    dutiableValue: string;
  };
  lines: LineEstimate[];
  fees: FeeLine[];
  taxes: TaxLine[];
  province?: { code: string; name: string; from: 'consignee' | 'buyer' | 'input' };
  totals: DutyTotals;
  preference?: {
    agreement: string;
    name: string;
    lines: number[];
    certification: 'complete' | 'incomplete' | 'missing' | 'not-checked';
    missingElements: CusmaElement[];
    /** The certification document the elements were read from, when one was uploaded. */
    documentId?: string;
  };
  cusma: { lineNo: number; origin: string; hint: string }[];
  findings: DutyFinding[];
  tables: TableMeta[];
  inputs: DutyInputs;
  disclaimer: string;
}
