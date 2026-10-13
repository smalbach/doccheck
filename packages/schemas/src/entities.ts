import { z } from 'zod';
import { Destination, DocumentType, SourceRef, TransportMode } from './common';

export const ShipmentStatus = z.enum([
  'RECEIVED', 'PARSING', 'EXTRACTING', 'NORMALIZING', 'VALIDATING', 'REVIEWING', 'DONE', 'NEEDS_INPUT', 'FAILED',
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;

export const DocumentStatus = z.enum(['QUEUED', 'EXTRACTING', 'EXTRACTED', 'FAILED']);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const ShipmentDocument = z.object({
  id: z.string(),
  shipmentId: z.string(),
  fileName: z.string(),
  storageKey: z.string(),
  sha256: z.string(),
  pageCount: z.number().int().nonnegative(),
  detectedType: DocumentType,
  typeConfidence: z.number().min(0).max(1),
  language: z.string().optional(),
  status: DocumentStatus.optional(),
  error: z.string().optional(),
});
export type ShipmentDocument = z.infer<typeof ShipmentDocument>;

export const Shipment = z.object({
  id: z.string(),
  reference: z.string().optional(),
  destination: Destination.optional(),
  transportMode: TransportMode.optional(),
  status: ShipmentStatus,
  documents: z.array(ShipmentDocument),
  createdAt: z.string(),
});
export type Shipment = z.infer<typeof Shipment>;

export const Severity = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type Severity = z.infer<typeof Severity>;

export const Evidence = z.object({
  documentId: z.string(),
  field: z.string(), // path inside the document: "lines[2].quantity"
  value: z.string(),
  source: SourceRef.optional(),
  /** The value was corrected by hand after extraction; the PDF prints something else. */
  corrected: z.boolean().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Finding = z.object({
  id: z.string(),
  shipmentId: z.string(),
  ruleId: z.string(),
  severity: Severity,
  decidedBy: z.enum(['RULE', 'AGENT']),
  message: z.string(),
  evidence: z.array(Evidence).min(1),
  regulation: z
    .object({ title: z.string(), url: z.string(), effectiveDate: z.string().optional(), excerpt: z.string() })
    .optional(),
  suggestedFix: z.string().optional(),
  agentRationale: z.string().optional(),
});
export type Finding = z.infer<typeof Finding>;
