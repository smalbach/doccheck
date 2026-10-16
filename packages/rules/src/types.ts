import type { BillOfLading, CommercialInvoice, Destination, DocumentType, Evidence, Isf, PackingList, Severity } from '@doccheck/schemas';

/** Normalized documents of one shipment, plus the id of the source document for each. */
export interface ShipmentContext {
  shipmentId: string;
  destination: Destination;
  invoice?: { id: string; data: CommercialInvoice };
  packingList?: { id: string; data: PackingList };
  billOfLading?: { id: string; data: BillOfLading };
  isf?: { id: string; data: Isf };
  /**
   * The day the validation runs (YYYY-MM-DD), for checks against "today" (an invoice dated in the
   * future). Passed in, never read from the clock, so a run can be replayed. Absent: those checks skip.
   */
  asOf?: string;
  /** What the account already has on file, for rules that compare with history (X17, X23, X24). */
  account?: AccountHistory;
}

/** Another shipment's invoice in the same account (X17). */
export interface PriorInvoice {
  shipmentId: string;
  shipmentReference?: string;
  documentId: string;
  invoiceNumber: string;
  sellerName?: string;
  invoiceDate?: string;
}

/** One past purchase of a product in the account (X23). */
export interface PricePoint {
  shipmentId: string;
  documentId: string;
  /** Index of the line in that invoice, for evidence. */
  line: number;
  invoiceNumber?: string;
  date?: string;
  unitPrice: string;
  currency: string;
  unit?: string;
}

/** A purchase order the account imported (X24). */
export interface PurchaseOrder {
  id: string;
  poNumber: string;
  sellerName?: string;
  currency?: string;
  lines: { lineNo?: number; sku?: string; description?: string; quantity: string; unit?: string; unitPrice?: string }[];
}

export interface AccountHistory {
  invoices?: PriorInvoice[];
  /** Past unit prices by product key (see productKey()). Other shipments only. */
  prices?: Record<string, PricePoint[]>;
  /** The orders that may match this invoice; the API loads only the one its PO number names. */
  purchaseOrders?: PurchaseOrder[];
  /** How many purchase orders the account has imported in all (X24 runs only when it uses them). */
  purchaseOrderCount?: number;
}

export type RuleKind = 'COMPLETENESS' | 'DETERMINISTIC' | 'AGENT';

export interface RuleDefinition {
  id: string;
  title: string;
  appliesTo: Destination[] | 'ALL';
  requires: DocumentType[];
  kind: RuleKind;
  severity: Severity;
  /** Tolerances an account can change for this rule (Rules settings). */
  params?: ParamSpec[];
}

/** A numeric tolerance a rule reads from RuleParams, with the bounds the settings page accepts. */
export interface ParamSpec {
  key: NumericParam;
  /** percent: a fraction shown as % (0.005 = 0.5%); days, hours, count; score: a plain number. */
  unit: 'percent' | 'days' | 'hours' | 'count' | 'score';
  min: number;
  max: number;
}

/** What a rule returns. The engine adds id, shipmentId and decidedBy. */
export interface RuleResult {
  message: string;
  evidence: Evidence[];
  severity?: Severity; // overrides the rule default when needed
  suggestedFix?: string;
}

export interface RuleParams {
  /** X3: allowed gross weight difference between packing list and BL, as a fraction. */
  grossWeightTolerance: number;
  /** X9: days tolerated between the invoice shipment date and the BL on-board date. */
  shipmentDateDays: number;
  /** X20: allowed difference between a container's VGM and its cargo weight plus tare, as a fraction. */
  vgmTolerance: number;
  /** X23: how far below the median past price a unit price must be to be flagged, as a fraction. */
  priceDeviation: number;
  /** X23: robust z-score (median / MAD) a price must also fall below. */
  priceScore: number;
  /** X23: past purchases needed before a price is compared. */
  priceMinHistory: number;
  /** X24: allowed quantity difference between the invoice and the purchase order, as a fraction. */
  poQuantityTolerance: number;
  /** X24: allowed unit price difference between the invoice and the purchase order, as a fraction. */
  poPriceTolerance: number;
  /** U3: hours before loading the ISF must be filed by (19 CFR 149.2(b): 24). */
  isfLeadHours: number;
  /** X15: SCACs the account uses besides the bundled carrier list (NVOCCs, regional lines). */
  knownScacs: string[];
}

export type NumericParam = { [K in keyof RuleParams]: RuleParams[K] extends number ? K : never }[keyof RuleParams];

export const DEFAULT_PARAMS: RuleParams = {
  grossWeightTolerance: 0.005,
  shipmentDateDays: 7,
  vgmTolerance: 0.05,
  priceDeviation: 0.3,
  priceScore: 3.5,
  priceMinHistory: 5,
  poQuantityTolerance: 0.05,
  poPriceTolerance: 0.02,
  isfLeadHours: 24,
  knownScacs: [],
};

/**
 * What an account changed from the defaults: rules turned off, a different severity, tolerances.
 * Stored per account (and later per organization) and recorded with each validation run.
 */
export interface RuleConfig {
  rules?: Record<string, { enabled?: boolean; severity?: Severity }>;
  params?: Partial<RuleParams>;
}

export interface Rule {
  definition: RuleDefinition;
  run(ctx: ShipmentContext, params: RuleParams): RuleResult[];
}
