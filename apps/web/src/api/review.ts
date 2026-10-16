import type { ExtractableType } from '../constants/documentTypes';
import { jsonBody } from './jsonBody';
import { queryString } from './queryString';
import { request } from './request';

/** Why the extraction doubts a value (packages/extraction/src/confidence.ts). */
export type ConfidenceReason = 'not-printed' | 'ocr' | 'normalizer' | 'passes-disagree' | 'low-logprob';

export interface ReviewField {
  path: string;
  /** The value now (after any correction); `modelValue` is what the extraction read. */
  value: string | number | null;
  modelValue: string | number | null;
  printed: string | null;
  confidence: number;
  reasons: ConfidenceReason[];
  source?: { documentId: string; page: number; bbox?: [number, number, number, number]; rawText: string };
  low: boolean;
  review?: { status: 'accepted' | 'corrected'; userId: string | null; createdAt: string };
}

export interface ReviewDocument {
  documentId: string;
  shipmentId: string;
  shipmentReference: string | null;
  destination: string | null;
  fileName: string;
  documentType: ExtractableType | 'UNKNOWN';
  pageCount: number;
  status: string;
  computedAt: string | null;
  threshold: number;
  fields: ReviewField[];
  /** The next document in the queue, if any. */
  next: string | null;
}

export interface ReviewQueueItem {
  documentId: string;
  shipmentId: string;
  shipmentReference: string | null;
  destination: string | null;
  fileName: string;
  documentType: ExtractableType | 'UNKNOWN';
  lowFields: number;
  pending: number;
  minConfidence: number;
  extractedAt: string;
}

export interface ReviewQueue {
  items: ReviewQueueItem[];
  total: number;
  fields: number;
  threshold: number;
  limit: number;
  offset: number;
}

export interface ReviewSummary {
  documents: number;
  fields: number;
  threshold: number;
}

export interface SupplierExampleRow {
  supplierKey: string;
  supplierName: string;
  documentType: string;
  field: string;
  modelValue: string | null;
  correctValue: string | null;
  line: string | null;
  createdAt: string;
}

export interface LearnedSuppliers {
  enabled: boolean;
  limit: number;
  suppliers: { key: string; name: string; examples: SupplierExampleRow[] }[];
}

const docPath = (documentId: string) => `/review/documents/${encodeURIComponent(documentId)}`;

/** Review queue and supplier learning calls. */
export const reviewApi = {
  queue: (query: { limit?: number; offset?: number } = {}) => request<ReviewQueue>(`/review/queue${queryString({ ...query })}`),
  summary: () => request<ReviewSummary>('/review/summary'),
  document: (documentId: string) => request<ReviewDocument>(docPath(documentId)),
  accept: (documentId: string, paths: string[]) => request<ReviewDocument>(`${docPath(documentId)}/accept`, jsonBody({ paths })),
  reopen: (documentId: string) => request<ReviewDocument>(`${docPath(documentId)}/accept`, { method: 'DELETE' }),
  suppliers: () => request<LearnedSuppliers>('/suppliers/examples'),
  forgetSupplier: (key: string) => request<LearnedSuppliers>(`/suppliers/examples/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};
