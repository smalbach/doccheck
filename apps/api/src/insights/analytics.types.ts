import type { CostEstimate } from './cost/cost';
import type { CostAssumptions } from './cost/penalties';
import type { PriceStats } from './price-stats';
import type { Score } from './score';

/** One group of a KPI breakdown: shipments in it, how many had findings on the first validation. */
export interface KpiGroup {
  key: string;
  label?: string;
  /** Validated shipments in the group (for a rule: those whose first validation ran it). */
  shipments: number;
  /** Of those, shipments with at least one finding of the group on the first validation. */
  withFindings: number;
  /** Findings on the first validation. */
  findings: number;
}

export interface KpiMonth {
  /** YYYY-MM of the first validation. */
  month: string;
  shipments: number;
  clean: number;
  findings: number;
}

export interface Kpis {
  range: { from?: string; to?: string; destination?: string };
  totals: {
    /** Shipments whose first validation falls in the range. */
    shipments: number;
    /** With no finding on that first validation. */
    cleanFirstPass: number;
    firstPassFindings: number;
    /** Findings of the latest validations still open (not accepted, not a false positive). */
    openFindings: number;
    /** Findings a later validation no longer had. */
    resolvedFindings: number;
    /** Accepted as a risk or marked a false positive. */
    dismissedFindings: number;
    /** Median hours from a finding's first validation to the one that no longer had it. */
    medianResolutionHours: number | null;
    /** Median hours from a correction request to the supplier's first reply. */
    medianResponseHours: number | null;
    requests: number;
    answered: number;
  };
  months: KpiMonth[];
  byRule: KpiGroup[];
  byDocumentType: KpiGroup[];
  bySupplier: KpiGroup[];
  byOrigin: KpiGroup[];
  byRoute: KpiGroup[];
}

export interface SupplierRow {
  partyId: string;
  name: string;
  country?: string;
  shipments: number;
  validatedShipments: number;
  cleanFirstPass: number;
  findings: number;
  requestedFindings: number;
  correctedFindings: number;
  requests: number;
  answered: number;
  medianResponseHours: number | null;
  score: Score;
  rank?: number;
}

export interface SupplierDetail extends SupplierRow {
  months: KpiMonth[];
  topRules: { ruleId: string; findings: number; shipments: number }[];
  requestsList: { threadId: string; shipmentId?: string; reference?: string; subject: string; sentAt?: string; firstReplyAt?: string; status: string }[];
}

export interface CostReport extends CostEstimate {
  assumptions: CostAssumptions;
  /** True when the organization kept the defaults. */
  defaults: boolean;
  shipments: number;
}

export type PriceGroupBy = 'product' | 'hs6';

export interface PriceGroup {
  /** product id, or "<hs6>:<origin>". */
  key: string;
  label: string;
  hs6?: string;
  origin?: string;
  currency: string;
  unit: string;
  stats: PriceStats;
  outliers: number;
}

export interface PricePointRow {
  shipmentId: string;
  reference?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  seller?: string;
  description: string;
  quantity?: string;
  unitPrice: string;
  outlier: boolean;
}

export interface PriceGroupDetail extends PriceGroup {
  points: PricePointRow[];
}

export interface QaAnswer {
  question: string;
  sql: string;
  /** Why the model wrote that query, in its words. */
  explanation?: string;
  columns: string[];
  rows: unknown[][];
  /** More rows matched than came back. */
  truncated: boolean;
  ms: number;
  model: string;
  /** Whether the read-only role was used (missing when the database user cannot create it). */
  role: boolean;
}

export interface RegulationChange {
  id: string;
  checkId: string;
  documentId: string;
  title: string;
  url: string;
  kind: 'added' | 'removed' | 'changed';
  section: string;
  before?: string;
  after?: string;
  effectiveBefore?: string;
  effectiveAfter?: string;
  rules: { destination: string; ruleId: string }[];
  detectedAt: string;
  unread: boolean;
  /** The account's shipments not done whose latest findings cite this document, through these rules. */
  affected: { shipmentId: string; reference?: string; ruleIds: string[]; citesPassage: boolean }[];
}

export interface RegulationCheck {
  id: string;
  startedAt: string;
  finishedAt?: string;
  trigger: string;
  documents: number;
  changes: number;
  errors: { id: string; error: string }[];
  baseline: boolean;
}

export interface RegulationChanges {
  checks: RegulationCheck[];
  changes: RegulationChange[];
  unread: number;
  /** Hours between scheduled checks; 0 when they are off. */
  intervalHours: number;
}
