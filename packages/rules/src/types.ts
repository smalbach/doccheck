import type {
  AirWaybill, ArrivalNotice, Attestation, BillOfLading, CertificateOfOrigin, CommercialInvoice, CusmaCertification, DangerousGoodsDeclaration, Destination,
  DocumentType, Evidence, Isf, PackingList, Severity, WoodPackagingCertificate,
} from '@doccheck/schemas';

/** Normalized documents of one shipment, plus the id of the source document for each. */
export interface ShipmentContext {
  shipmentId: string;
  destination: Destination;
  invoice?: { id: string; data: CommercialInvoice };
  packingList?: { id: string; data: PackingList };
  billOfLading?: { id: string; data: BillOfLading };
  isf?: { id: string; data: Isf };
  /** Air shipments: the air waybill takes the place of the bill of lading (rules T1-T6). */
  airWaybill?: { id: string; data: AirWaybill };
  certificateOfOrigin?: { id: string; data: CertificateOfOrigin };
  cusmaCertification?: { id: string; data: CusmaCertification };
  arrivalNotice?: { id: string; data: ArrivalNotice };
  woodPackaging?: { id: string; data: WoodPackagingCertificate };
  dangerousGoods?: { id: string; data: DangerousGoodsDeclaration };
  /** Signature and stamp seen on the paper, by document id (rule T13). Absent: not checked. */
  attestations?: Record<string, Attestation>;
}

/** Which document type fills each slot of the context. */
export const CONTEXT_SLOTS = {
  invoice: 'COMMERCIAL_INVOICE',
  packingList: 'PACKING_LIST',
  billOfLading: 'BILL_OF_LADING',
  isf: 'ISF',
  airWaybill: 'AIR_WAYBILL',
  certificateOfOrigin: 'CERTIFICATE_OF_ORIGIN',
  cusmaCertification: 'CUSMA_CERTIFICATION',
  arrivalNotice: 'ARRIVAL_NOTICE',
  woodPackaging: 'WOOD_PACKAGING_CERTIFICATE',
  dangerousGoods: 'DANGEROUS_GOODS_DECLARATION',
} as const satisfies Partial<Record<keyof ShipmentContext, DocumentType>>;
export type ContextSlot = keyof typeof CONTEXT_SLOTS;

export type RuleKind = 'COMPLETENESS' | 'DETERMINISTIC' | 'AGENT';

export interface RuleDefinition {
  id: string;
  title: string;
  appliesTo: Destination[] | 'ALL';
  requires: DocumentType[];
  kind: RuleKind;
  severity: Severity;
  /**
   * The rule is about a document a shipment may simply not have (a certificate of origin, an air
   * waybill): without its documents it is not applicable rather than skipped for missing input.
   */
  optional?: boolean;
  /** Besides `requires`, at least one of these must be present (optional rules: not applicable otherwise). */
  requiresAny?: DocumentType[];
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
}

export const DEFAULT_PARAMS: RuleParams = { grossWeightTolerance: 0.005 };

export interface Rule {
  definition: RuleDefinition;
  /** Optional rules: false when the shipment gives the rule nothing to check (not applicable, like a missing document). */
  applies?(ctx: ShipmentContext): boolean;
  run(ctx: ShipmentContext, params: RuleParams): RuleResult[];
}
