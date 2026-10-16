/** Shapes of the DocCheck API v1 (docs/api/openapi.json is the reference). */

export type Destination = 'CA' | 'US';
export type TransportMode = 'SEA' | 'AIR' | 'ROAD';
export type ShipmentStatus = 'RECEIVED' | 'PARSING' | 'EXTRACTING' | 'NORMALIZING' | 'VALIDATING' | 'REVIEWING' | 'DONE' | 'NEEDS_INPUT' | 'FAILED';
export type DocumentType = 'COMMERCIAL_INVOICE' | 'PACKING_LIST' | 'BILL_OF_LADING' | 'ISF' | 'UNKNOWN';
export type DocumentStatus = 'QUEUED' | 'EXTRACTING' | 'EXTRACTED' | 'FAILED';
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ExportFormat = 'cargowise-xml' | 'x12-856' | 'x12-310';

export interface Document {
  id: string;
  fileName: string;
  sha256: string;
  pageCount: number;
  detectedType: DocumentType;
  typeConfidence: number;
  language?: string;
  status: DocumentStatus;
  error?: string;
}

export interface Shipment {
  id: string;
  reference?: string;
  destination?: Destination;
  transportMode?: TransportMode;
  status: ShipmentStatus;
  createdAt: string;
  documents: Document[];
}

export interface ShipmentSummary extends Omit<Shipment, 'documents'> {
  documentCount: number;
  /** Open findings of the latest validation; null if never validated. */
  findingCount: number | null;
}

export interface ShipmentList {
  items: ShipmentSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface DocumentDetail {
  document: Document;
  documentType?: DocumentType;
  /** Normalized values: decimal strings for money and weights, ISO dates, kilograms. */
  data?: Record<string, unknown> | null;
  issues?: string[];
  corrected?: { path: string; modelValue: unknown }[];
}

export interface Evidence {
  documentId: string;
  /** Path inside the document: "lines[2].quantity". */
  field: string;
  value: string;
  source?: { documentId: string; page: number; line?: number; bbox?: [number, number, number, number]; text?: string };
  corrected?: boolean;
}

export interface Finding {
  id: string;
  shipmentId: string;
  ruleId: string;
  severity: Severity;
  decidedBy: 'RULE' | 'AGENT';
  message: string;
  evidence: Evidence[];
  regulation?: { title: string; url: string; effectiveDate?: string; excerpt: string };
  suggestedFix?: string;
  agentRationale?: string;
  fingerprint: string;
  review?: { status: 'open' | 'waiting_supplier' | 'accepted' | 'false_positive'; note?: string; at: string };
  isNew?: boolean;
}

export interface Validation {
  id: string;
  createdAt: string;
  destination?: Destination;
  ran: string[];
  skipped: { ruleId: string; missing: DocumentType[] }[];
  findings: Finding[];
  resolved?: Finding[];
}

export interface SendResult {
  connector: string;
  format: ExportFormat;
  status: 'accepted' | 'rejected';
  reference?: string;
  message?: string;
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  issues?: { path: (string | number)[]; message: string; code?: string }[];
}

/** Webhook event types; `ping` is the test send. */
export type EventType = 'document.extracted' | 'validation.completed' | 'finding.created' | 'finding.resolved' | 'supplier.replied' | 'ping';

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: EventType;
  createdAt: string;
  data: T;
}
