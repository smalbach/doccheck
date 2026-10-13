import type { DocumentType, Evidence, Finding, Shipment, ShipmentDocument } from '@doccheck/schemas';

export type { DocumentType, Evidence, Finding, Shipment, ShipmentDocument };

export type Destination = 'CA' | 'US';

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

export type SettingKey = 'llmModel' | 'agentEnabled' | 'ocrLanguages' | 'ocrScale' | 'ocrPsm';

export interface SettingValues {
  llmModel: string;
  agentEnabled: boolean;
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

export interface DocumentDetail {
  data: ExtractedData | null;
  issues: string[];
  model?: string;
  promptVersion?: string;
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
}
