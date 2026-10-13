import type { DocumentType, Finding, Shipment, ShipmentDocument } from '@doccheck/schemas';

export type { Finding, Shipment, ShipmentDocument };

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

export interface Validation {
  id: string;
  createdAt: string;
  ran: string[];
  skipped: { ruleId: string; missing: DocumentType[] }[];
  inputs: Record<string, string>;
  agent?: { status: 'done' | 'skipped' | 'failed'; citations: number; decisions: AgentDecision[]; error?: string };
  findings: Finding[];
}

export interface Sample {
  id: string;
  destination: 'CA' | 'US';
  templates: string[];
  errors: { kind: string; description: string; expectedRuleIds: string[] }[];
}

export interface RuleDefinition {
  id: string;
  title: string;
  kind: string;
  severity: string;
}

export interface IsfFiling {
  /** 'upload' (JSON), 'sample' or 'pdf' (extracted from an uploaded filing confirmation). */
  source: string;
  updatedAt: string;
  documentId?: string;
  fileName?: string;
  data: { seller: { name: string }; buyer: { name: string }; countryOfOrigin: string; htsCode: string; importerOfRecordNumber: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  shipments: () => request<ShipmentSummary[]>('/shipments'),
  shipment: (id: string) => request<Shipment>(`/shipments/${id}`),
  create: (body: { reference?: string; destination: 'CA' | 'US' }) => request<Shipment>('/shipments', json({ ...body, transportMode: 'SEA' })),
  upload: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<{ documents: ShipmentDocument[] }>(`/shipments/${id}/documents`, { method: 'POST', body: form });
  },
  validate: (id: string, agent = true) => request<Validation>(`/shipments/${id}/validate${agent ? '' : '?agent=false'}`, { method: 'POST' }),
  validation: (id: string) => request<Validation>(`/shipments/${id}/validation`),
  fileUrl: (id: string, documentId: string) => `/shipments/${id}/documents/${documentId}/file`,
  isf: (id: string) => request<IsfFiling>(`/shipments/${id}/isf`),
  saveIsf: (id: string, isf: unknown) => request<IsfFiling>(`/shipments/${id}/isf`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(isf) }),
  deleteIsf: (id: string) => fetch(`/shipments/${id}/isf`, { method: 'DELETE' }),
  samples: () => request<Sample[]>('/demo/samples'),
  loadSample: (sampleId: string) => request<Shipment>(`/demo/samples/${sampleId}`, { method: 'POST' }),
  rules: (destination: 'CA' | 'US') => request<RuleDefinition[]>(`/rules?destination=${destination}`),
};
