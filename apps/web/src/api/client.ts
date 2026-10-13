import type { ExtractableType } from '../constants/documentTypes';
import { jsonBody } from './jsonBody';
import { request } from './request';
import type {
  Destination,
  DocumentDetail,
  Health,
  IsfFiling,
  Results,
  RuleDefinition,
  Sample,
  Shipment,
  ShipmentDocument,
  ShipmentSummary,
  Validation,
} from './types';

const shipmentPath = (id: string) => `/shipments/${encodeURIComponent(id)}`;
const documentPath = (id: string, documentId: string) => `${shipmentPath(id)}/documents/${encodeURIComponent(documentId)}`;

/** Every call the web app makes to the API. */
export const api = {
  health: () => request<Health>('/health'),

  shipments: () => request<ShipmentSummary[]>('/shipments'),
  shipment: (id: string) => request<Shipment>(shipmentPath(id)),
  create: (body: { reference?: string; destination: Destination }) => request<Shipment>('/shipments', jsonBody({ ...body, transportMode: 'SEA' })),
  remove: (id: string) => request<void>(shipmentPath(id), { method: 'DELETE' }),

  upload: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request<{ documents: ShipmentDocument[] }>(`${shipmentPath(id)}/documents`, { method: 'POST', body: form });
  },
  document: (id: string, documentId: string) => request<DocumentDetail>(documentPath(id, documentId)),
  reextract: (id: string, documentId: string, type: ExtractableType) => request<ShipmentDocument>(`${documentPath(id, documentId)}/reextract`, jsonBody({ type })),
  fileUrl: (id: string, documentId: string) => `${documentPath(id, documentId)}/file`,

  validate: (id: string, agent: boolean) => request<Validation>(`${shipmentPath(id)}/validate${agent ? '' : '?agent=false'}`, { method: 'POST' }),
  validation: (id: string) => request<Validation>(`${shipmentPath(id)}/validation`),
  rules: (destination: Destination) => request<RuleDefinition[]>(`/rules?destination=${destination}`),

  isf: (id: string) => request<IsfFiling>(`${shipmentPath(id)}/isf`),
  saveIsf: (id: string, isf: unknown) => request<IsfFiling>(`${shipmentPath(id)}/isf`, jsonBody(isf, 'PUT')),
  deleteIsf: (id: string) => request<void>(`${shipmentPath(id)}/isf`, { method: 'DELETE' }),

  samples: () => request<Sample[]>('/demo/samples'),
  loadSample: (sampleId: string) => request<Shipment>(`/demo/samples/${encodeURIComponent(sampleId)}`, { method: 'POST' }),

  results: () => request<Results>('/results'),
};
