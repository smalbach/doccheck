import { BillOfLading, CommercialInvoice, Destination, DocumentStatus, DocumentType, Finding, Isf, PackingList, ShipmentStatus, TransportMode, type Shipment, type ShipmentDocument } from '@doccheck/schemas';
import { z } from 'zod';
import type { ReviewedFinding } from '../../shipments/reviews.types';
import { REVIEW_STATUSES } from '../../shipments/reviews.types';

/**
 * Requests and answers of the public REST API v1. These schemas validate the requests and are the
 * source of the OpenAPI document (openapi.ts), so the spec cannot drift from what the API checks.
 * Answers leave out internal fields (storage keys, model traces).
 */

export const CreateShipmentRequest = z
  .object({
    reference: z.string().trim().min(1).max(200).optional().describe('Your reference: a file number, PO or booking.'),
    destination: Destination.optional().describe('CA (CBSA) or US (CBP). Needed before validating.'),
    transportMode: TransportMode.optional(),
  })
  .strict()
  .meta({ id: 'CreateShipmentRequest' });

export const ListShipmentsQuery = z.object({
  status: z.enum(['all', 'open', 'attention', 'done']).default('all').describe('open: not validated yet or extracting; attention: validated with open findings; done: validated with none.'),
  destination: Destination.optional(),
  q: z.string().trim().max(200).optional().describe('Text in the reference or id.'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ValidateQuery = z.object({
  agent: z.enum(['true', 'false']).optional().describe('false skips the local model review of ambiguous cases. Default: the server setting.'),
  wait: z.enum(['true', 'false']).default('false').describe('true answers when the validation is done (200, with the findings); otherwise 202 at once and validation.completed follows.'),
});

export const ExportFormatParam = z.enum(['cargowise-xml', 'x12-856', 'x12-310']);
export const SendExportRequest = z.object({ connector: z.string().min(1).max(50).describe('Connector id, e.g. "mock".') }).strict().meta({ id: 'SendExportRequest' });

export const V1Document = z
  .object({
    id: z.uuid(),
    fileName: z.string(),
    sha256: z.string(),
    pageCount: z.number().int(),
    detectedType: DocumentType,
    typeConfidence: z.number(),
    language: z.string().optional(),
    status: DocumentStatus,
    error: z.string().optional(),
  })
  .meta({ id: 'Document' });

export const V1Shipment = z
  .object({
    id: z.uuid(),
    reference: z.string().optional(),
    destination: Destination.optional(),
    transportMode: TransportMode.optional(),
    status: ShipmentStatus,
    createdAt: z.iso.datetime(),
    documents: z.array(V1Document),
  })
  .meta({ id: 'Shipment' });

export const V1ShipmentSummary = z
  .object({
    id: z.uuid(),
    reference: z.string().optional(),
    destination: Destination.optional(),
    transportMode: TransportMode.optional(),
    status: ShipmentStatus,
    createdAt: z.iso.datetime(),
    documentCount: z.number().int(),
    findingCount: z.number().int().nullable().describe('Open findings of the latest validation; null if never validated.'),
  })
  .meta({ id: 'ShipmentSummary' });

export const V1ShipmentList = z
  .object({ items: z.array(V1ShipmentSummary), total: z.number().int(), limit: z.number().int(), offset: z.number().int() })
  .meta({ id: 'ShipmentList' });

export const V1Upload = z
  .object({ documents: z.array(V1Document).describe('Queued for extraction; document.extracted follows for each.') })
  .meta({ id: 'UploadResult' });

export const V1DocumentDetail = z
  .object({
    document: V1Document,
    documentType: DocumentType.optional(),
    data: z.union([CommercialInvoice, PackingList, BillOfLading, Isf]).nullable().optional().describe('Normalized values, as the validation reads them. Absent until extracted.'),
    issues: z.array(z.string()).optional(),
    corrected: z.array(z.object({ path: z.string(), modelValue: z.unknown() })).optional().describe('Values corrected by hand in the app, with what the model had read.'),
  })
  .meta({ id: 'DocumentDetail' });

const Review = z.object({ status: z.enum(REVIEW_STATUSES), note: z.string().optional(), at: z.iso.datetime() });

export const V1Finding = Finding.extend({
  fingerprint: z.string().describe('Stable across validations while the rule and values stay the same.'),
  review: Review.optional().describe("The user's latest decision about it."),
  isNew: z.boolean().optional(),
}).meta({ id: 'Finding' });

export const V1Validation = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    destination: Destination.optional(),
    ran: z.array(z.string()).describe('Rule ids that ran.'),
    skipped: z.array(z.object({ ruleId: z.string(), missing: z.array(DocumentType) })).describe('Rules that could not run, and the documents they lack.'),
    findings: z.array(V1Finding),
    resolved: z.array(V1Finding).optional().describe('Findings of the previous validation that are gone.'),
  })
  .meta({ id: 'Validation' });

export const V1ValidationQueued = z
  .object({ shipmentId: z.uuid(), status: z.literal('VALIDATING') })
  .meta({ id: 'ValidationQueued' });

export const V1SendResult = z
  .object({ connector: z.string(), format: ExportFormatParam, status: z.enum(['accepted', 'rejected']), reference: z.string().optional(), message: z.string().optional() })
  .meta({ id: 'SendResult' });

export const V1Error = z
  .object({
    statusCode: z.number().int(),
    error: z.string().describe('The HTTP reason phrase.'),
    message: z.string(),
    issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string(), code: z.string().optional() })).optional().describe('What failed validation, per field.'),
  })
  .meta({ id: 'Error' });

export type V1Shipment = z.infer<typeof V1Shipment>;

export const toV1Document = (d: ShipmentDocument): z.infer<typeof V1Document> => ({
  id: d.id,
  fileName: d.fileName,
  sha256: d.sha256,
  pageCount: d.pageCount,
  detectedType: d.detectedType,
  typeConfidence: d.typeConfidence,
  ...(d.language ? { language: d.language } : {}),
  status: d.status ?? 'QUEUED',
  ...(d.error ? { error: d.error } : {}),
});

export const toV1Shipment = (s: Shipment): V1Shipment => ({
  id: s.id,
  ...(s.reference ? { reference: s.reference } : {}),
  ...(s.destination ? { destination: s.destination } : {}),
  ...(s.transportMode ? { transportMode: s.transportMode } : {}),
  status: s.status,
  createdAt: s.createdAt,
  documents: s.documents.map(toV1Document),
});

export const toV1Finding = (f: ReviewedFinding | (Finding & { fingerprint: string })): z.infer<typeof V1Finding> => {
  const { history: _h, review, ...rest } = f as ReviewedFinding;
  return { ...rest, ...(review ? { review: { status: review.status, ...(review.note ? { note: review.note } : {}), at: review.at } } : {}) };
};
