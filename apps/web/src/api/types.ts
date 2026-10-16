import type { DocumentType, Evidence, Finding, Shipment, ShipmentDocument } from '@doccheck/schemas';

export type { DocumentType, Evidence, Finding, Shipment, ShipmentDocument };

// Live progress events (GET /shipments/:id/events, GET /events, /events/estimates, /events/labels): types only, shared with the API
// through @doccheck/schemas so the contract has one definition (docs/PROGRESS-EVENTS.md).
export type {
  ActivityLabels,
  AgentAnswer,
  ExtractionDetail,
  ExtractionEvent,
  ExtractionStage,
  FindingPreview,
  ProgressEstimates,
  ProgressEvent,
  ProgressKind,
  ProgressStatus,
  StageEstimate,
  ValidationDetail,
  ValidationEvent,
  ValidationStage,
} from '@doccheck/schemas';

export type Destination = 'CA' | 'US';
export type TransportMode = 'SEA' | 'AIR' | 'ROAD';

/** Status groups the list filters on, computed by the API. */
export type StatusGroup = 'all' | 'open' | 'attention' | 'done';

export interface ShipmentListQuery {
  status?: StatusGroup;
  destination?: Destination;
  q?: string;
  /** overdue: past its due date and not done; soon: due in 48 hours. */
  due?: 'overdue' | 'soon';
  /** "me" or a member's id. */
  assignee?: string;
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
  /** findings: open ones (not accepted nor false positive); waiting: asked of the supplier. */
  summary: { all: number; open: number; attention: number; done: number; findings: number; waiting: number; overdue?: number; dueSoon?: number };
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
  dueAt?: string;
  dueSource?: 'manual' | 'isf' | 'eta';
  overdue?: boolean;
  assignee?: { id: string; name: string };
}

export interface AgentDecision {
  ruleId: string;
  question: string;
  verdict: 'yes' | 'no' | 'unsure';
  confidence: number;
  rationale: string;
  effect: 'kept' | 'dismissed' | 'added' | 'none';
}

/** Whether a declared HS code is in the destination schedule (packages/tariff, codeStatus). */
export type TariffCodeStatus = 'valid' | 'subheading' | 'heading' | 'national-unknown' | 'unknown' | 'malformed' | 'missing' | 'not-checked';

export interface AgencyFlag {
  id: string;
  agency: string;
  program: string;
  severity: 'LOW' | 'MEDIUM';
}

export interface TariffNoteQuote {
  ref: string;
  url: string;
  excerpt: string;
}

/** One invoice line as the tariff check sees it. */
export interface TariffLine {
  index: number;
  lineNo: number;
  description: string;
  declared?: string;
  code?: string;
  status: TariffCodeStatus;
  title?: string;
  agencies: AgencyFlag[];
  exportControl: { id: string; category: number; label: string }[];
  fit?: { verdict: 'yes' | 'no' | 'unsure'; confidence: number; rationale: string; notes: TariffNoteQuote[]; by: 'agent' | 'search' };
  suggestions?: { code: string; title: string; confidence?: number; rationale?: string; agencies: AgencyFlag[] }[];
  suggestionNotes?: TariffNoteQuote[];
}

export interface TariffNotice {
  id: string;
  ruleId: string;
  severity: Finding['severity'];
  message: string;
  suggestedFix?: string;
  regulation?: { title: string; url: string; excerpt: string };
}

export interface TariffReport {
  /** "Harmonized Tariff Schedule of the United States, 2026 HTS Revision 21"; absent when no schedule was loaded. */
  schedule?: string;
  url?: string;
  /** Tariff rules that did not run for lack of the schedule. */
  unavailable: string[];
  /** P1 (other agencies) and E1 (possible dual-use): what the entry may also need, with the source; not findings. Absent on runs before they moved here. */
  notices?: TariffNotice[];
  lines: TariffLine[];
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
  agent?: { status: 'done' | 'skipped' | 'failed'; citations: number; decisions: AgentDecision[]; error?: string; tariff?: TariffReport };
  findings: ValidationFinding[];
  /** Latest run only: the run before it, and its findings that are gone (resolved). */
  previous?: { id: string; createdAt: string };
  resolved?: ValidationFinding[];
}

/** open: nothing decided (or undone); waiting_supplier: corrected documents asked for; accepted, false_positive: closed. */
export type ReviewStatus = 'open' | 'waiting_supplier' | 'accepted' | 'false_positive';

export interface FindingReview {
  status: ReviewStatus;
  note?: string;
  userName?: string;
  at: string;
}

/** A finding as a validation run returns it; the latest run adds the user's decisions. */
export type ValidationFinding = Finding & {
  /** The rule and the evidence's fields and values: the same finding in another run has the same one. */
  fingerprint?: string;
  review?: FindingReview;
  /** Newest first. */
  history?: FindingReview[];
  /** Not in the previous run. */
  isNew?: boolean;
};

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

export type SettingKey = 'llmModel' | 'agentEnabled' | 'registrationOpen' | 'ocrEngine' | 'ocrUrl' | 'ocrLanguages' | 'ocrScale' | 'ocrPsm';

export type OcrEngine = 'tesseract' | 'unlimited';

export interface SettingValues {
  llmModel: string;
  agentEnabled: boolean;
  registrationOpen: boolean;
  ocrEngine: OcrEngine;
  ocrUrl: string;
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
  options: { ocrLanguages: string[]; ocrPsm: string[]; ocrScale: { min: number; max: number }; ocrEngines: OcrEngine[] };
  editable: boolean;
  /** With the Unlimited-OCR engine in use: whether its server answers. */
  ocrServer?: { url: string; reachable: boolean };
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
  ocr: { engine: OcrEngine; languages: string[]; scale: number; psm: string };
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
  /** Lines of invoices where this company is the seller or the buyer. */
  party?: string;
  product?: string;
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

/** A company of the user's documents, found again across shipments by its normalized name. */
export interface PartySummary {
  id: string;
  name: string;
  country?: string;
  taxId?: string;
  roles: PartyRoleName[];
  /** How the documents spell it. */
  names: string[];
  shipments: number;
  invoices: number;
  lines: number;
  values: Total[];
  products: number;
  firstDate?: string;
  lastDate?: string;
}

export type PartyRoleName = 'seller' | 'buyer' | 'consignee' | 'exporter' | 'originator' | 'shipper' | 'notify' | 'manufacturer' | 'ship_to' | 'consolidator';

export interface PartyAddress {
  name: string;
  lines: string[];
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  taxId?: string;
  contact?: { name?: string; email?: string; phone?: string };
  roles: PartyRoleName[];
  documents: number;
}

export interface PartyDetail extends PartySummary {
  addresses: PartyAddress[];
  /** Other companies on the same documents. */
  related: { id: string; name: string; country?: string; roles: PartyRoleName[]; shipments: number }[];
  topProducts: { id: string; sku?: string; description: string; lines: number; quantities: Total[]; values: Total[] }[];
  recentShipments: {
    shipmentId: string;
    reference?: string;
    destination?: Destination;
    createdAt: string;
    roles: PartyRoleName[];
    invoiceNumber?: string;
    invoiceDate?: string;
    invoiceTotal?: { amount: string; currency: string };
  }[];
}

export interface PartiesQuery {
  destination?: Destination;
  q?: string;
  role?: 'supplier' | 'customer';
  limit?: number;
  offset?: number;
}

/** Unit price statistics in one currency; avg is weighted by quantity. */
export interface PriceStats {
  currency: string;
  min: string;
  max: string;
  avg: string;
  last: string;
}

export interface ProductSummary {
  id: string;
  sku?: string;
  description: string;
  hsCode?: string;
  countryOfOrigin?: string;
  unit?: string;
  lines: number;
  shipments: number;
  sellers: number;
  lastSeller?: string;
  lastDate?: string;
  quantities: Total[];
  values: Total[];
  prices: PriceStats[];
}

/** One purchase of a product: an invoice line. */
export interface PricePoint {
  shipmentId: string;
  reference?: string;
  documentId: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  sellerId?: string;
  seller?: string;
  quantity?: { value: string; unit: string };
  unitPrice?: { amount: string; currency: string };
  lineTotal?: { amount: string; currency: string };
}

export interface ProductDetail extends ProductSummary {
  /** Oldest first. */
  history: PricePoint[];
  bySeller: { id: string; name: string; country?: string; lines: number; quantities: Total[]; prices: PriceStats[]; lastDate?: string }[];
  descriptions: { text: string; lines: number }[];
  hsCodes: { code: string; lines: number }[];
  origins: { country: string; lines: number }[];
}

/** A container on a bill of lading. */
export interface ContainerRow {
  shipmentId: string;
  reference?: string;
  destination?: Destination;
  documentId: string;
  number: string;
  ownerCode?: string;
  sizeType?: string;
  seal?: string;
  packages?: number;
  grossKg?: string;
  volumeM3?: string;
  blNumber?: string;
  carrier?: string;
  scac?: string;
  vessel?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  shippedDate?: string;
}

export interface ContainersQuery {
  destination?: Destination;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface ProductsQuery {
  destination?: Destination;
  q?: string;
  origin?: string;
  hs?: string;
  limit?: number;
  offset?: number;
}

export type AlertKind = 'critical' | 'failed-document' | 'ocr' | 'not-validated' | 'stale-destination' | 'mail-reply' | 'mail-overdue' | 'mail-failed' | 'mail-intake';

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
  /** A conversation about the shipment: unread replies, no answer by its due date, or a message that could not be sent. */
  | { kind: 'mail-reply' | 'mail-overdue' | 'mail-failed'; detail: { threadId: string; subject: string; count: number } }
  | { kind: 'mail-intake'; detail: { threadId: string; subject: string; status: IntakeStatus; findings: number | null } }
);

export interface AlertList {
  /** Newest first, capped by the API. */
  items: Alert[];
  /** Every alert of each kind, also those past the cap. */
  counts: Record<AlertKind, number>;
  total: number;
}

// Mail ---------------------------------------------------------------------------------------------

export type ThreadStatus = 'awaiting' | 'replied' | 'closed';
export type ThreadKind = 'correction_request' | 'conversation' | 'intake';
export type MailMessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'received';
export type ThreadFilter = 'open' | 'unread' | 'awaiting' | 'overdue' | 'failed' | 'closed' | 'all';

export interface MailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** The shipment document made from it, once added. */
  documentId?: string;
}

export interface MailMessage {
  id: string;
  threadId?: string;
  direction: 'out' | 'in';
  status: MailMessageStatus;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  attempts: number;
  error?: string;
  /** smtp, or log when the server has no SMTP (captured, not delivered). */
  transport?: string;
  userName?: string;
  sentAt?: string;
  receivedAt?: string;
  readAt?: string;
  /** The receiving server reported a failed DMARC, DKIM or SPF check: the From may be forged. */
  senderUnverified?: boolean;
  createdAt: string;
  attachments: MailAttachment[];
}

export interface ThreadSummary {
  id: string;
  kind: ThreadKind;
  status: ThreadStatus;
  subject: string;
  shipmentId?: string;
  shipmentReference?: string;
  partyId?: string;
  partyName?: string;
  unread: number;
  overdue: boolean;
  dueAt?: string;
  failed: boolean;
  counterpart?: string;
  lastMessageAt: string;
  createdAt: string;
  messages: number;
}

export type IntakeStatus = 'extracting' | 'validating' | 'validated' | 'needs_destination' | 'failed' | 'skipped';

/** What happened to the PDFs of an email sent to the user's intake address. */
export interface Intake {
  id: string;
  status: IntakeStatus;
  shipmentId?: string;
  createdShipment: boolean;
  documents: number;
  findings?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadDetail extends ThreadSummary {
  /** Documents by email only. */
  intakes?: Intake[];
  language?: string;
  /** Where the other side's replies go (with this thread's +token). */
  replyTo: string;
  fingerprints: string[];
  items: MailMessage[];
}

export interface MailSummary {
  unread: number;
  awaiting: number;
  overdue: number;
  failed: number;
  /** Admins only. */
  unassigned?: number;
}

/** Everyone gets `sending`, `from` and `replyTo`; the rest is for admins. */
export interface MailStatus {
  sending: 'smtp' | 'log';
  from?: string;
  replyTo?: string;
  receiving?: { imap: boolean; webhook: boolean; mailboxes: { mailbox: string; polledAt: string; error?: string; lastUid: number }[] };
  queue?: { queued: number; failed: number };
  followUpDays?: number;
}

export interface MailContact {
  email: string;
  name?: string;
  /** received: it emailed this shipment's documents in. */
  source: 'received' | 'saved' | 'document';
  partyId?: string;
}

export interface NewThread {
  kind: ThreadKind;
  shipmentId?: string;
  partyId?: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  language?: string;
  fingerprints: string[];
}

export interface MailServerInput {
  smtp: { host: string; port: number; secure: boolean; user: string; password?: string } | null;
  from: string;
  replyTo: string | null;
  plusAddressing: boolean;
  imap: { host: string; port: number; secure: boolean; user: string; password?: string; mailbox: string; pollSeconds: number } | null;
  intake: { enabled: boolean; notifySender: boolean };
}

/** Whether the mail server takes "+code" addresses (a test email to one, sent on save). */
export interface PlusCheck {
  status: 'checking' | 'ok' | 'rejected' | 'unconfirmed';
  address: string;
  checkedAt: string;
  detail?: string;
  /** rejected: DocCheck turned +codes off. */
  turnedOff?: boolean;
}

export interface MailServerSettings {
  /** admin: saved from the web; env: from .env; none: nothing set. */
  source: 'admin' | 'env' | 'none';
  editable: boolean;
  plusCheck?: PlusCheck;
  updatedAt?: string;
  updatedBy?: string;
  config:
    | (Omit<MailServerInput, 'smtp' | 'imap'> & {
        smtp: { host: string; port: number; secure: boolean; user: string; hasPassword: boolean } | null;
        imap: { host: string; port: number; secure: boolean; user: string; hasPassword: boolean; mailbox: string; pollSeconds: number } | null;
      })
    | null;
}
