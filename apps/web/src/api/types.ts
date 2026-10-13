import type { DocumentType, Evidence, Finding, Shipment, ShipmentDocument } from '@doccheck/schemas';

export type { DocumentType, Evidence, Finding, Shipment, ShipmentDocument };

export type Destination = 'CA' | 'US';
export type TransportMode = 'SEA' | 'AIR' | 'ROAD';

/** Status groups the list filters on, computed by the API. */
export type StatusGroup = 'all' | 'open' | 'attention' | 'done';

export interface ShipmentListQuery {
  status?: StatusGroup;
  destination?: Destination;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ShipmentPage {
  items: ShipmentSummary[];
  /** Shipments matching the filters. */
  total: number;
  limit: number;
  offset: number;
  /** Over all of the user's shipments, whatever the filters. */
  summary: { all: number; open: number; attention: number; done: number; findings: number };
}

export interface ShipmentUpdate {
  reference?: string | null;
  destination?: Destination;
  transportMode?: TransportMode;
}

/** One run in a shipment's validation history. */
export interface ValidationSummary {
  id: string;
  createdAt: string;
  destination?: Destination;
  ran: number;
  skipped: number;
  agentStatus?: 'done' | 'skipped' | 'failed';
  findings: number;
  bySeverity: Partial<Record<Finding['severity'], number>>;
}

export interface ShipmentSummary extends Omit<Shipment, 'documents'> {
  documentCount: number;
  findingCount: number | null;
}

export interface AgentDecision {
  ruleId: string;
  question: string;
  verdict: 'yes' | 'no' | 'unsure';
  confidence: number;
  rationale: string;
  effect: 'kept' | 'dismissed' | 'added' | 'none';
}

export interface SkippedRule {
  ruleId: string;
  missing: DocumentType[];
}

export interface Validation {
  id: string;
  createdAt: string;
  /** The destination whose rules ran (missing on runs from before it was recorded). */
  destination?: Destination;
  ran: string[];
  skipped: SkippedRule[];
  inputs: Record<string, string>;
  agent?: { status: 'done' | 'skipped' | 'failed'; citations: number; decisions: AgentDecision[]; error?: string };
  findings: Finding[];
}

export interface SampleError {
  kind: string;
  description: string;
  expectedRuleIds: string[];
}

export interface Sample {
  id: string;
  destination: Destination;
  templates: string[];
  errors: SampleError[];
}

export interface RuleDefinition {
  id: string;
  title: string;
  appliesTo: Destination[] | 'ALL';
  requires: DocumentType[];
  kind: string;
  severity: Finding['severity'];
}

export type Role = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export type SettingKey = 'llmModel' | 'agentEnabled' | 'registrationOpen' | 'ocrLanguages' | 'ocrScale' | 'ocrPsm';

export interface SettingValues {
  llmModel: string;
  agentEnabled: boolean;
  registrationOpen: boolean;
  ocrLanguages: string[];
  ocrScale: number;
  ocrPsm: string;
}

export interface SettingView<K extends SettingKey = SettingKey> {
  key: K;
  value: SettingValues[K];
  source: 'default' | 'env' | 'admin';
  defaultValue: SettingValues[K];
  envValue?: SettingValues[K];
  updatedAt?: string;
  updatedBy?: string;
}

export interface AdminSettings {
  settings: SettingView[];
  options: { ocrLanguages: string[]; ocrPsm: string[]; ocrScale: { min: number; max: number } };
  editable: boolean;
}

export interface InstalledModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  current: boolean;
  evaluated: { accuracy: number; documents: number } | null;
}

export interface AdminModels {
  reachable: boolean;
  current: string;
  models: InstalledModel[];
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  shipmentCount: number;
}

export interface SystemStatus {
  demo: boolean;
  ollama: { url: string; reachable: boolean; models: number };
  model: { provider: string; build: string | null };
  embeddings: { model: string; chunks: number | null };
  queue: 'bullmq' | 'in-process';
  storage: 's3' | 'disk';
  cache: { dir: string | null; mode: string };
  ocr: { languages: string[]; scale: number; psm: string };
  agentEnabled: boolean;
  counts: { users: number; shipments: number; documents: number; validations: number };
}

export interface IsfFiling {
  /** 'upload' (JSON), 'sample' or 'pdf' (extracted from an uploaded filing confirmation). */
  source: string;
  updatedAt: string;
  documentId?: string;
  fileName?: string;
  data: { seller: { name: string }; buyer: { name: string }; countryOfOrigin: string; htsCode: string; importerOfRecordNumber: string };
}

/** Normalized document as returned by the extraction: a loose record, read through field paths. */
export type ExtractedData = Record<string, unknown>;

/** A value corrected by hand: its JSON pointer and what the model had read. */
export interface CorrectedField {
  path: string;
  modelValue: unknown;
}

export interface DocumentDetail {
  data: ExtractedData | null;
  issues: string[];
  model?: string;
  promptVersion?: string;
  /** Values corrected by hand, once extracted. */
  corrected?: CorrectedField[];
}

/** One value to correct: a JSON pointer ("/lines/0/quantity/value"); null removes an optional field. */
export interface DataChange {
  path: string;
  value: string | number | boolean | null;
}

export interface RuleScore {
  rule: string;
  tp: number;
  fp: number;
  fn: number;
  recall: number | null;
  precision: number | null;
}

export interface Tally {
  total: number;
  correct: number;
  accuracy: number;
}

export interface ExtractionReport {
  set: string;
  file: string;
  provider: string;
  modelVersion?: string;
  promptVersion: string;
  shipments: number;
  documents: number;
  failedDocuments: number;
  classificationAccuracy: number;
  overall: Tally;
  byType: { type: string; accuracy: number; total: number }[];
  byTemplate: { template: string; accuracy: number; total: number }[];
  weakestFields: { type: string; field: string; accuracy: number; total: number }[];
  rules: { shipmentsWithAllDocuments: number; table: RuleScore[] };
}

export interface AgentSummary {
  kind: string;
  cases: number;
  accuracy: number;
  effectAccuracy?: number;
  wrong: number;
  unsure: number;
}

export interface Results {
  extraction: ExtractionReport[];
  agent: { provider: string; modelVersion?: string; summary: AgentSummary[] } | null;
}

export interface Health {
  demo?: boolean;
  registrationOpen?: boolean;
}

/** A sum per currency or unit; amounts stay decimal strings. */
export interface Total {
  key: string;
  amount: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Extracted data of all of the user's shipments, added up. */
export interface InsightsSummary {
  shipments: number;
  invoiceLines: number;
  valueByCurrency: Total[];
  quantityByUnit: Total[];
  grossKg: string;
  netKg: string;
  packages: number;
  containers: number;
  byOrigin: { country: string | null; lines: number; values: Total[] }[];
  byHsCode: { hsCode: string | null; description: string; lines: number; values: Total[] }[];
}

/** One commercial invoice line, with the shipment it belongs to. */
export interface GoodsLine {
  shipmentId: string;
  reference?: string;
  destination?: Destination;
  documentId: string;
  invoiceNumber?: string;
  seller?: string;
  lineNo: number;
  sku?: string;
  description: string;
  hsCode?: string;
  countryOfOrigin?: string;
  quantity?: { value: string; unit: string };
  unitPrice?: { amount: string; currency: string };
  lineTotal?: { amount: string; currency: string };
}

export interface GoodsQuery {
  destination?: Destination;
  q?: string;
  origin?: string;
  hs?: string;
  limit?: number;
  offset?: number;
}

/** The key figures of one shipment, from its invoice, packing list and bill of lading. */
export interface ShipmentData {
  shipmentId: string;
  reference?: string;
  destination?: Destination;
  createdAt: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  seller?: string;
  buyer?: string;
  incoterm?: string;
  invoiceTotal?: { amount: string; currency: string };
  lines: number;
  packages?: number;
  grossKg?: string;
  netKg?: string;
  volumeM3?: string;
  blNumber?: string;
  carrier?: string;
  vessel?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  containers: string[];
}

export interface ShipmentDataQuery {
  destination?: Destination;
  q?: string;
  limit?: number;
  offset?: number;
}

export type AlertKind = 'critical' | 'failed-document' | 'ocr' | 'not-validated' | 'stale-destination';

/** Something on one of the user's shipments that needs a look (GET /shipments/alerts). */
export type Alert = {
  shipmentId: string;
  reference?: string;
  /** When the cause happened; the list is newest first. */
  at: string;
} & (
  | { kind: 'critical'; detail: { critical: number; high: number } }
  | { kind: 'failed-document'; documentId: string; fileName: string; detail: { error?: string } }
  /** `citedBy`: findings of the latest validation citing the document; 0 when the shipment was never validated. */
  | { kind: 'ocr'; documentId: string; fileName: string; detail: { citedBy: number } }
  | { kind: 'not-validated'; detail: { reason: 'never' | 'changed' } }
  | { kind: 'stale-destination'; detail: { validated: Destination; current?: Destination } }
);

export interface AlertList {
  /** Newest first, capped by the API. */
  items: Alert[];
  /** Every alert of each kind, also those past the cap. */
  counts: Record<AlertKind, number>;
  total: number;
}
