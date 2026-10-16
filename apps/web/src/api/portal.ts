import type { DocumentType, Severity } from '@doccheck/schemas';
import { ApiError } from './ApiError';
import { jsonBody } from './jsonBody';
import { queryString } from './queryString';
import { request } from './request';
import type { Destination, Paged } from './types';

/** Where the text of an email goes the request's portal link; the server puts the link in when it sends it. */
export const LINK_PLACEHOLDER = '{{portal-link}}';

export type PortalKind = 'correction' | 'pre_shipment';
export type PortalStatus = 'waiting' | 'checking' | 'open' | 'clean' | 'failed' | 'closed';

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
  state: 'open' | 'fixed';
  message: string;
  evidence: PortalEvidence[];
  regulation?: { title: string; url: string };
}

export interface PortalUpload {
  id: string;
  status: 'extracting' | 'validating' | 'validated' | 'failed';
  files: string[];
  findings?: number;
  error?: string;
  createdAt: string;
}

/** What a supplier sees with a link. */
export interface PortalView {
  kind: PortalKind;
  status: PortalStatus;
  reference?: string;
  destination?: Destination;
  importer: string;
  supplier?: string;
  language?: 'en' | 'es' | 'fr';
  expiresAt: string;
  findings: PortalFinding[];
  skipped: { ruleId: string; missing: DocumentType[] }[];
  validatedAt?: string;
  uploads: PortalUpload[];
  history: { kind: PortalKind; reference?: string; status: PortalStatus; createdAt: string; current: boolean }[];
  limits: { maxFileBytes: number; maxFiles: number; maxTotalBytes: number };
}

export interface PortalRequest {
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
  linkExpiresAt?: string;
  lastActivityAt?: string;
  createdAt: string;
  closedAt?: string;
}

export type PortalEventKind = 'link_created' | 'link_revoked' | 'opened' | 'uploaded' | 'upload_refused' | 'checked' | 'denied';

export interface PortalRequestDetail extends PortalRequest {
  links: { id: string; active: boolean; expiresAt: string; revokedAt?: string; lastUsedAt?: string; createdAt: string }[];
  events: { kind: PortalEventKind; reason?: string; files?: string[]; findings?: number; count?: number; ip?: string; createdAt: string }[];
}

export interface PortalLink {
  id: string;
  /** Absolute when the server knows its public address (APP_URL). */
  url?: string;
  path: string;
  expiresAt: string;
}

export interface NewPreShipment {
  partyId?: string;
  supplierName?: string;
  reference: string;
  destination: Destination;
  language: 'en' | 'es' | 'fr';
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  days?: number;
}

/** A link's address to copy: the server's, or this site's when the server does not know its own. */
export const linkAddress = (link: PortalLink) => link.url ?? `${window.location.origin}${link.path}`;

/** The supplier's calls: the link's token in a header, no cookie. */
async function portalCall<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, credentials: 'omit', headers: { ...init.headers, 'x-portal-token': token } });
  const body = (await res.json().catch(() => ({}))) as { message?: string; reason?: string };
  if (!res.ok) throw new PortalError(res.status, body.message ?? `${res.status}`, body.reason);
  return body as T;
}

/** A refusal from the portal, with why: invalid, expired, revoked, closed or throttled. */
export class PortalError extends ApiError {
  constructor(
    status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(status, message, []);
  }
}

export const portalApi = {
  session: (token: string) => portalCall<PortalView>(token, '/portal/session'),
  upload: (token: string, files: File[], note?: string) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    if (note) form.append('note', note);
    return portalCall<PortalView>(token, '/portal/uploads', { method: 'POST', body: form });
  },
  // The importer's side (signed in).
  requests: (query: { partyId?: string; threadId?: string; shipmentId?: string; kind?: PortalKind; limit?: number; offset?: number }) =>
    request<Paged<PortalRequest>>(`/supplier-portal/requests${queryString({ ...query })}`),
  request: (id: string) => request<PortalRequestDetail>(`/supplier-portal/requests/${encodeURIComponent(id)}`),
  createPreShipment: (body: NewPreShipment) => request<PortalRequestDetail>('/supplier-portal/requests', jsonBody(body)),
  link: (id: string) => request<PortalLink>(`/supplier-portal/requests/${encodeURIComponent(id)}/link`),
  newLink: (id: string, days?: number) => request<PortalLink>(`/supplier-portal/requests/${encodeURIComponent(id)}/links`, jsonBody(days ? { days } : {})),
  revoke: (id: string, linkId?: string) => request<PortalRequestDetail>(`/supplier-portal/requests/${encodeURIComponent(id)}/revoke`, jsonBody(linkId ? { linkId } : {})),
  close: (id: string, closed: boolean) => request<PortalRequestDetail>(`/supplier-portal/requests/${encodeURIComponent(id)}/close`, jsonBody({ closed })),
  forThread: (threadId: string) => request<PortalRequestDetail>(`/supplier-portal/threads/${encodeURIComponent(threadId)}/request`, jsonBody({})),
};
