import { EVENT_TYPES } from '@doccheck/integrations';
import { z } from 'zod';
import {
  CreateShipmentRequest, ExportFormatParam, ListShipmentsQuery, SendExportRequest, V1Document, V1DocumentDetail, V1Error, V1Finding, V1SendResult, V1Shipment, V1ShipmentList, V1ShipmentSummary, V1Upload,
  V1Validation, V1ValidationQueued, ValidateQuery,
} from './v1.schemas';

type Json = Record<string, unknown>;

const COMPONENTS: z.ZodType[] = [CreateShipmentRequest, SendExportRequest, V1Document, V1Shipment, V1ShipmentSummary, V1ShipmentList, V1Upload, V1DocumentDetail, V1Finding, V1Validation, V1ValidationQueued, V1SendResult, V1Error];

/** Each schema with an id becomes a component; references between them become $refs. */
function components(): Record<string, Json> {
  const registry = z.registry<{ id: string }>();
  for (const s of COMPONENTS) registry.add(s, { id: (s.meta() as { id: string }).id });
  const { schemas } = z.toJSONSchema(registry, { uri: (id) => `#/components/schemas/${id}`, unrepresentable: 'any' }) as { schemas: Record<string, Json> };
  return Object.fromEntries(Object.entries(schemas).map(([id, { $schema: _s, $id: _i, ...rest }]) => [id, rest]));
}

/** Query parameters from a Zod object, as the request is read (defaults included). */
function queryParams(schema: z.ZodObject): Json[] {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as { properties: Record<string, Json>; required?: string[] };
  return Object.entries(json.properties).map(([name, { description, ...s }]) => ({ name, in: 'query', required: json.required?.includes(name) ?? false, ...(description ? { description } : {}), schema: s }));
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const json = (id: string, description: string) => ({ description, content: { 'application/json': { schema: ref(id) } } });
const pathId = (name: string, description: string) => ({ name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' } });
const idempotencyKey = { name: 'Idempotency-Key', in: 'header', required: false, description: 'Any string up to 255 characters, new per operation. A retry with the same key gets the first answer (Idempotent-Replayed: true) instead of doing the work twice. Kept 24 hours.', schema: { type: 'string', maxLength: 255 } };
const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((c) => [
      String(c),
      json('Error', ({ 400: 'Invalid request', 402: 'The organization\u2019s plan limit is reached', 401: 'Missing, invalid or revoked API key', 403: 'The key lacks the scope', 404: 'Not found (or not this account’s)', 409: 'Not possible in the current state', 422: 'Idempotency-Key reused for another request', 429: 'Rate limit reached; see Retry-After' } as Record<number, string>)[c] ?? 'Error'),
    ]),
  );
const common = [401, 403, 429];

/** The OpenAPI 3.1 document of the public REST API v1. */
export function openApiDocument(serverUrl = '/'): Json {
  const shipmentId = pathId('id', 'Shipment id');
  return {
    openapi: '3.1.0',
    info: {
      title: 'DocCheck API',
      version: '1.0.0',
      description:
        'Create shipments, upload their freight documents (commercial invoice, packing list, bill of lading or air waybill, ISF, certificates of origin and the other supported types), validate them against the requirements of Canada, the US, Mexico, the EU or the UK and read the findings. Authenticate with an API key from Integrations → API keys: `Authorization: Bearer dck_...`. Keys have the read and/or write scope and a limit of requests per minute (RateLimit-* headers). Events (' +
        EVENT_TYPES.join(', ') +
        ') are pushed to webhooks signed with HMAC-SHA256 (DocCheck-Signature header).',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    tags: [{ name: 'Shipments' }, { name: 'Documents' }, { name: 'Validation' }, { name: 'Exports' }],
    paths: {
      '/api/v1/shipments': {
        get: {
          operationId: 'listShipments',
          tags: ['Shipments'],
          summary: 'List shipments',
          description: 'Newest first. Scope: read.',
          parameters: queryParams(ListShipmentsQuery),
          responses: { 200: json('ShipmentList', 'A page of shipments'), ...errors(400, ...common) },
        },
        post: {
          operationId: 'createShipment',
          tags: ['Shipments'],
          summary: 'Create a shipment',
          description: 'Scope: write. Send the destination now or later in the app; validation needs it.',
          parameters: [idempotencyKey],
          requestBody: { required: true, content: { 'application/json': { schema: ref('CreateShipmentRequest') } } },
          responses: { 201: json('Shipment', 'The new shipment'), ...errors(400, 409, 422, ...common) },
        },
      },
      '/api/v1/shipments/{id}': {
        get: {
          operationId: 'getShipment',
          tags: ['Shipments'],
          summary: 'Get a shipment with its documents and status',
          description: 'Scope: read. status: RECEIVED → EXTRACTING → VALIDATING → DONE (or NEEDS_INPUT when a rule lacks a document).',
          parameters: [shipmentId],
          responses: { 200: json('Shipment', 'The shipment'), ...errors(404, ...common) },
        },
      },
      '/api/v1/shipments/{id}/documents': {
        post: {
          operationId: 'uploadDocuments',
          tags: ['Documents'],
          summary: 'Upload documents',
          description: 'Scope: write. Up to 10 files of 20 MB each in the multipart field "files": PDFs (a combined PDF is split into its documents), spreadsheets (.xlsx, .csv) or photos (JPEG, PNG, HEIC; straightened into a PDF). Each is classified and extracted by the local model; document.extracted follows for each. Every file counts as an extraction of the organization\'s plan: past a hard limit the upload is refused with 402.',
          parameters: [shipmentId, idempotencyKey],
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } }, required: ['files'] } } },
          },
          responses: { 202: json('UploadResult', 'Queued for extraction'), ...errors(400, 402, 404, 409, 422, ...common) },
        },
      },
      '/api/v1/shipments/{id}/documents/{documentId}': {
        get: {
          operationId: 'getDocument',
          tags: ['Documents'],
          summary: 'Get a document and its extracted data',
          description: 'Scope: read. `data` holds the normalized values (decimal strings, ISO dates, kilograms) once the document is EXTRACTED.',
          parameters: [shipmentId, pathId('documentId', 'Document id')],
          responses: { 200: json('DocumentDetail', 'The document'), ...errors(404, ...common) },
        },
      },
      '/api/v1/shipments/{id}/validate': {
        post: {
          operationId: 'validateShipment',
          tags: ['Validation'],
          summary: 'Validate the shipment',
          description: 'Scope: write. Runs the deterministic rules on the extracted documents, cites regulations and lets the local model review ambiguous cases. Answers 202 at once (validation.completed follows), or 200 with the validation when wait=true.',
          parameters: [shipmentId, ...queryParams(ValidateQuery)],
          responses: { 200: json('Validation', 'Done (wait=true)'), 202: json('ValidationQueued', 'Started'), ...errors(400, 402, 404, 409, ...common) },
        },
      },
      '/api/v1/shipments/{id}/findings': {
        get: {
          operationId: 'getFindings',
          tags: ['Validation'],
          summary: 'Latest validation and its findings',
          description: 'Scope: read. Each finding cites its evidence (document, JSON pointer, page and line) and, where one exists, the regulation passage. 404 before the first validation.',
          parameters: [shipmentId],
          responses: { 200: json('Validation', 'The latest validation'), ...errors(404, ...common) },
        },
      },
      '/api/v1/shipments/{id}/exports/{format}': {
        get: {
          operationId: 'exportShipment',
          tags: ['Exports'],
          summary: 'Download an export',
          description: 'Scope: read. CargoWise Universal Shipment XML or ANSI X12 004010 (856 ship notice, 310 ocean freight receipt), built from the documents the latest validation read; an air shipment exports from its air waybill (the 310, an ocean bill of lading, is refused for it). 409 before validation or when a document the format needs is missing.',
          parameters: [shipmentId, { name: 'format', in: 'path', required: true, schema: z.toJSONSchema(ExportFormatParam) }],
          responses: {
            200: { description: 'The file', content: { 'application/xml': { schema: { type: 'string' } }, 'application/edi-x12': { schema: { type: 'string' } } } },
            ...errors(400, 404, 409, ...common),
          },
        },
      },
      '/api/v1/shipments/{id}/exports/{format}/send': {
        post: {
          operationId: 'sendExport',
          tags: ['Exports'],
          summary: 'Send an export through a connector',
          description: 'Scope: write. Only the "mock" connector ships with DocCheck; live connectors (CargoWise eAdapter, a VAN) need partner credentials.',
          parameters: [shipmentId, { name: 'format', in: 'path', required: true, schema: z.toJSONSchema(ExportFormatParam) }],
          requestBody: { required: true, content: { 'application/json': { schema: ref('SendExportRequest') } } },
          responses: { 200: json('SendResult', 'What the connector answered'), ...errors(400, 404, 409, ...common) },
        },
      },
    },
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'dck_<prefix>_<secret>', description: 'An API key from Integrations → API keys.' } },
      schemas: components(),
    },
    webhooks: Object.fromEntries(
      EVENT_TYPES.map((type) => [
        type,
        {
          post: {
            summary: type,
            description: 'POSTed as JSON to each webhook subscribed to the event. Verify DocCheck-Signature: "t=<unix>,v1=<hex HMAC-SHA256 of `<t>.<raw body>` with the signing secret>". Answer 2xx within 10 s; anything else is retried with backoff.',
            parameters: [{ name: 'DocCheck-Signature', in: 'header', required: true, schema: { type: 'string' } }, { name: 'DocCheck-Event', in: 'header', required: true, schema: { type: 'string', const: type } }],
            requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['id', 'type', 'createdAt', 'data'], properties: { id: { type: 'string', format: 'uuid' }, type: { const: type }, createdAt: { type: 'string', format: 'date-time' }, data: { type: 'object' } } } } } },
            responses: { 200: { description: 'Received' } },
          },
        },
      ]),
    ),
  };
}
