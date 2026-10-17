import { jsonBody } from './jsonBody';
import { queryString } from './queryString';
import { request, UNAUTHORIZED_EVENT } from './request';
import type { Destination } from './types';

// Mirrors apps/api/src/insights/analytics.types.ts and cost/penalties.ts.

export interface AnalyticsFilter {
  destination?: Destination;
  from?: string;
  to?: string;
}

export interface KpiGroup {
  key: string;
  label?: string;
  shipments: number;
  withFindings: number;
  findings: number;
}

export interface KpiMonth {
  month: string;
  shipments: number;
  clean: number;
  findings: number;
}

export interface Kpis {
  totals: {
    shipments: number;
    cleanFirstPass: number;
    firstPassFindings: number;
    openFindings: number;
    resolvedFindings: number;
    dismissedFindings: number;
    medianResolutionHours: number | null;
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

export interface SupplierScore {
  score: number | null;
  components: { firstPass: number | null; correction: number | null; responsiveness: number | null };
  lowData: boolean;
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
  score: SupplierScore;
  rank?: number;
}

export interface SupplierDetail extends SupplierRow {
  months: KpiMonth[];
  topRules: { ruleId: string; findings: number; shipments: number }[];
  requestsList: { threadId: string; shipmentId?: string; reference?: string; subject: string; sentAt?: string; firstReplyAt?: string; status: string }[];
}

export interface Penalty {
  id: string;
  destination: Destination;
  ruleIds: string[];
  label: string;
  reference: string;
  url?: string;
  amount: string;
  currency: string;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface CostAssumptions {
  penalties: Penalty[];
  delay: { severities: Severity[]; days: number; perDay: Partial<Record<Destination, { amount: string; currency: string }>> };
  transitDays: { SEA: number; AIR: number; ROAD: number };
}

export type CostOutcome = 'avoided' | 'late' | 'exposed';

export interface CostItem {
  shipmentId: string;
  reference?: string;
  item: string;
  label: string;
  ruleIds: string[];
  outcome: CostOutcome;
  amount: string;
  currency: string;
  arrival: string;
}

export interface Money {
  amount: string;
  currency: string;
}

export interface CostReport {
  items: CostItem[];
  totals: Record<CostOutcome, Money[]>;
  /** Rules that found something where no penalty is mapped (hold only). */
  unmapped: string[];
  assumptions: CostAssumptions;
  defaults: boolean;
  shipments: number;
}

export type PriceGroupBy = 'product' | 'hs6';

export interface PriceStats {
  n: number;
  min: string;
  q1: string;
  median: string;
  q3: string;
  max: string;
  low?: string;
  high?: string;
}

export interface PriceGroup {
  key: string;
  label: string;
  hs6?: string;
  origin?: string;
  currency: string;
  unit: string;
  stats: PriceStats;
  outliers: number;
}

export interface PricePoint {
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
  points: PricePoint[];
}

export interface QaResult {
  sql: string;
  explanation?: string;
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  ms: number;
  role: boolean;
  model?: string;
  question?: string;
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
  rules: { destination: Destination; ruleId: string }[];
  detectedAt: string;
  unread: boolean;
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
  intervalHours: number;
}

/** A refused or failed question: the API's message, and the query when the model wrote one. */
export class QaError extends Error {
  constructor(
    message: string,
    readonly code?: 'sql_rejected' | 'sql_failed',
    readonly sql?: string,
  ) {
    super(message);
  }
}

/** POST for Data Q&A that keeps the query of a refused or failed answer (request() keeps only the message). */
async function qaRequest(path: string, body: unknown): Promise<QaResult> {
  const res = await fetch(path, { credentials: 'same-origin', ...jsonBody(body) });
  const json = (await res.json().catch(() => ({}))) as Partial<QaResult> & { message?: string | string[]; code?: 'sql_rejected' | 'sql_failed' };
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new QaError(Array.isArray(json.message) ? json.message.join(', ') : json.message || `${res.status} ${res.statusText}`, json.code, json.sql);
  return json as QaResult;
}

const q = (f: AnalyticsFilter, extra: Record<string, string | undefined> = {}) => queryString({ ...f, ...extra });

/** The analytics routes (apps/api/src/insights/analytics.controller.ts). */
export const analyticsApi = {
  kpis: (f: AnalyticsFilter) => request<Kpis>(`/analytics/kpis${q(f)}`),
  kpisCsvUrl: (f: AnalyticsFilter) => `/analytics/kpis.csv${q(f)}`,
  suppliers: (f: AnalyticsFilter) => request<SupplierRow[]>(`/analytics/suppliers${q(f)}`),
  suppliersCsvUrl: (f: AnalyticsFilter) => `/analytics/suppliers.csv${q(f)}`,
  supplier: (id: string, f: AnalyticsFilter) => request<SupplierDetail>(`/analytics/suppliers/${encodeURIComponent(id)}${q(f)}`),
  cost: (f: AnalyticsFilter) => request<CostReport>(`/analytics/cost${q(f)}`),
  saveCost: (assumptions: CostAssumptions) => request<void>('/analytics/cost/assumptions', jsonBody({ assumptions }, 'PUT')),
  resetCost: () => request<void>('/analytics/cost/assumptions', { method: 'DELETE' }),
  prices: (f: { destination?: Destination; by: PriceGroupBy; q?: string; outliers?: boolean }) =>
    request<PriceGroup[]>(`/analytics/prices${queryString({ destination: f.destination, by: f.by, q: f.q, outliers: f.outliers ? 'true' : undefined })}`),
  priceGroup: (f: { destination?: Destination; by: PriceGroupBy; key: string; currency: string; unit: string }) => request<PriceGroupDetail>(`/analytics/prices/group${queryString({ ...f })}`),
  ask: (question: string) => qaRequest('/analytics/qa', { question }),
  runSql: (sql: string) => qaRequest('/analytics/qa/run', { sql }),
  regulations: () => request<RegulationChanges>('/analytics/regulations'),
  regulationsUnread: () => request<{ unread: number }>('/analytics/regulations/unread'),
  markRegulationsRead: () => request<void>('/analytics/regulations/read', { method: 'POST' }),
  checkRegulations: () => request<RegulationCheck>('/analytics/regulations/check', { method: 'POST' }),
};
