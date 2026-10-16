import type { DocumentType, Severity } from '@doccheck/schemas';

export type PortalKind = 'correction' | 'pre_shipment';

/**
 * Where a request stands: waiting for the supplier, checking what they uploaded, findings left (open),
 * nothing left (clean), the last upload could not be checked (failed), or closed by the importer.
 */
export type PortalStatus = 'waiting' | 'checking' | 'open' | 'clean' | 'failed' | 'closed';

export type PortalEventKind = 'link_created' | 'link_revoked' | 'opened' | 'uploaded' | 'upload_refused' | 'checked' | 'denied';

/** A request as its row and counts, before it is shown to anyone. */
export interface PortalRequestRow {
  id: string;
  userId: string;
  kind: PortalKind;
  shipmentId: string;
  partyId?: string;
  supplierName?: string;
  threadId?: string;
  reference?: string;
  shipmentReference?: string;
  destination?: string;
  language?: string;
  fingerprints: string[];
  createdAt: string;
  closedAt?: string;
  /** Uploads still extracting or validating. */
  pending: number;
  uploads: number;
  lastUploadStatus?: 'extracting' | 'validating' | 'validated' | 'failed';
  /** Findings of the latest validation that concern the supplier. */
  open: number;
  /** A validation ran after the request was made. */
  validatedSince: boolean;
  lastActivityAt?: string;
}

export interface PortalLinkRow {
  id: string;
  requestId: string;
  tokenHash: Buffer;
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

/** What a request is, from the importer's side. */
export interface PortalRequestSummary {
  id: string;
  kind: PortalKind;
  status: PortalStatus;
  shipmentId: string;
  shipmentReference?: string;
  reference?: string;
  partyId?: string;
  supplier?: string;
  threadId?: string;
  language?: string;
  open: number;
  uploads: number;
  /** The link the supplier can use now, when there is one. */
  linkExpiresAt?: string;
  lastActivityAt?: string;
  createdAt: string;
  closedAt?: string;
}

export interface PortalLinkView {
  id: string;
  active: boolean;
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export interface PortalEventView {
  kind: PortalEventKind;
  /** A refused access: why (expired, revoked, closed). */
  reason?: string;
  files?: string[];
  findings?: number;
  /** For "opened": how many times in that hour from that address. */
  count?: number;
  ip?: string;
  createdAt: string;
}

export interface PortalRequestDetail extends PortalRequestSummary {
  links: PortalLinkView[];
  events: PortalEventView[];
}

/** One value a finding cites, as the supplier sees it: no document ids, no internal notes. */
export interface PortalEvidence {
  documentType: DocumentType;
  field: string;
  value: string;
  page?: number;
}

export interface PortalFinding {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  /** open: still found by the latest validation; fixed: asked for, and gone since. */
  state: 'open' | 'fixed';
  /** The rule's own sentence, for rules the web has no guide for. */
  message: string;
  evidence: PortalEvidence[];
  regulation?: { title: string; url: string };
}

export interface PortalUploadView {
  id: string;
  status: 'extracting' | 'validating' | 'validated' | 'failed';
  files: string[];
  findings?: number;
  error?: string;
  createdAt: string;
}

/** The portal page of a link: one request, and the supplier's earlier requests by status only. */
export interface PortalView {
  kind: PortalKind;
  status: PortalStatus;
  reference?: string;
  destination?: string;
  importer: string;
  supplier?: string;
  language?: string;
  expiresAt: string;
  findings: PortalFinding[];
  /** Rules the latest validation could not run, with the documents they need (pre-shipment: the B/L). */
  skipped: { ruleId: string; missing: DocumentType[] }[];
  validatedAt?: string;
  uploads: PortalUploadView[];
  history: { kind: PortalKind; reference?: string; status: PortalStatus; createdAt: string; current: boolean }[];
  limits: { maxFileBytes: number; maxFiles: number; maxTotalBytes: number };
}
