import type { BillOfLading, CommercialInvoice, Destination, DocumentType, Evidence, Isf, PackingList, Severity } from '@doccheck/schemas';

/** Normalized documents of one shipment, plus the id of the source document for each. */
export interface ShipmentContext {
  shipmentId: string;
  destination: Destination;
  invoice?: { id: string; data: CommercialInvoice };
  packingList?: { id: string; data: PackingList };
  billOfLading?: { id: string; data: BillOfLading };
  isf?: { id: string; data: Isf };
}

export type RuleKind = 'COMPLETENESS' | 'DETERMINISTIC' | 'AGENT';

export interface RuleDefinition {
  id: string;
  title: string;
  appliesTo: Destination[] | 'ALL';
  requires: DocumentType[];
  kind: RuleKind;
  severity: Severity;
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
  run(ctx: ShipmentContext, params: RuleParams): RuleResult[];
}
