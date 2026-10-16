import { jsonBody } from '../../api/jsonBody';
import { request } from '../../api/request';

export type EventType = 'document.extracted' | 'validation.completed' | 'finding.created' | 'finding.resolved' | 'supplier.replied';
export type ApiScope = 'read' | 'write';
export type ExportFormat = 'cargowise-xml' | 'x12-856' | 'x12-310';

export interface Overview {
  events: EventType[];
  connectors: { id: string; name: string; formats: ExportFormat[] }[];
  deliveryMode: 'bullmq' | 'poller';
  localRoot: string;
  openapi: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  rateLimit: number;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface LastDelivery {
  status: string;
  at: string;
  responseStatus: number | null;
}

export interface Webhook {
  id: string;
  url: string;
  description: string | null;
  events: EventType[];
  active: boolean;
  createdAt: string;
  lastDelivery: LastDelivery | null;
}

export interface ChatAlert {
  id: string;
  kind: 'slack' | 'teams';
  name: string;
  urlHost: string;
  events: EventType[];
  includeDetails: boolean;
  active: boolean;
  createdAt: string;
  lastDelivery: LastDelivery | null;
}

export interface Delivery {
  id: string;
  targetType: 'webhook' | 'chat';
  targetId: string;
  eventId: string | null;
  eventType: string;
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  redeliveryOf: string | null;
  createdAt: string;
  deliveredAt: string | null;
  payload?: unknown;
}

export type SourceKind = 'local' | 'sftp' | 's3';
export interface SourceInput {
  name: string;
  kind: SourceKind;
  config: Record<string, string | number>;
  secret?: string;
  groupBy: 'folder' | 'filename';
  pattern?: string | null;
  destination?: 'CA' | 'US' | null;
  validate: boolean;
  pollSeconds: number;
  active: boolean;
}
export interface Source extends Omit<SourceInput, 'secret'> {
  id: string;
  hasSecret: boolean;
  lastPolledAt: string | null;
  lastError: string | null;
  createdAt: string;
  recent: { path: string; reference: string | null; status: 'imported' | 'skipped' | 'failed'; shipmentId: string | null; error: string | null; createdAt: string }[];
}
export type SourceTest = { ok: true; pdfs: number; sample: { path: string; reference: string | null }[] } | { ok: false; error: string };

export type TrackingProvider = 'mock' | 'project44' | 'vizion' | 'terminal49';
export interface TrackingSettings {
  enabled: boolean;
  provider: TrackingProvider;
  endpoint: string | null;
  hasApiKey: boolean;
  mockScenario: 'consistent' | 'conflicting';
  providers: TrackingProvider[];
}
export interface TrackingInput {
  enabled: boolean;
  provider: TrackingProvider;
  endpoint?: string | null;
  apiKey?: string | null;
  mockScenario?: 'consistent' | 'conflicting';
}

const patch = (body: unknown): RequestInit => ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const post: RequestInit = { method: 'POST' };
const del: RequestInit = { method: 'DELETE' };
const id = (v: string) => encodeURIComponent(v);

/** Calls of the Integrations page (signed-in session). */
export const integrationsApi = {
  overview: () => request<Overview>('/integrations'),

  apiKeys: () => request<ApiKey[]>('/integrations/api-keys'),
  createApiKey: (body: { name: string; scopes: ApiScope[]; rateLimit?: number }) => request<ApiKey & { key: string }>('/integrations/api-keys', jsonBody(body)),
  revokeApiKey: (keyId: string) => request<ApiKey>(`/integrations/api-keys/${id(keyId)}/revoke`, post),

  webhooks: () => request<Webhook[]>('/integrations/webhooks'),
  createWebhook: (body: { url: string; description?: string; events: EventType[] }) => request<Webhook & { secret: string }>('/integrations/webhooks', jsonBody(body)),
  updateWebhook: (hookId: string, body: Partial<{ url: string; description: string | null; events: EventType[]; active: boolean }>) => request<Webhook>(`/integrations/webhooks/${id(hookId)}`, patch(body)),
  deleteWebhook: (hookId: string) => request<void>(`/integrations/webhooks/${id(hookId)}`, del),
  webhookSecret: (hookId: string) => request<{ secret: string | null }>(`/integrations/webhooks/${id(hookId)}/secret`, post),
  rotateWebhookSecret: (hookId: string) => request<{ secret: string }>(`/integrations/webhooks/${id(hookId)}/rotate-secret`, post),
  testWebhook: (hookId: string) => request<Delivery>(`/integrations/webhooks/${id(hookId)}/test`, post),
  webhookDeliveries: (hookId: string) => request<Delivery[]>(`/integrations/webhooks/${id(hookId)}/deliveries`),

  chatAlerts: () => request<ChatAlert[]>('/integrations/chat-alerts'),
  createChatAlert: (body: { kind: 'slack' | 'teams'; name: string; url: string; events: EventType[]; includeDetails: boolean }) => request<ChatAlert>('/integrations/chat-alerts', jsonBody(body)),
  updateChatAlert: (alertId: string, body: Partial<{ name: string; url: string; events: EventType[]; includeDetails: boolean; active: boolean }>) => request<ChatAlert>(`/integrations/chat-alerts/${id(alertId)}`, patch(body)),
  deleteChatAlert: (alertId: string) => request<void>(`/integrations/chat-alerts/${id(alertId)}`, del),
  testChatAlert: (alertId: string) => request<Delivery>(`/integrations/chat-alerts/${id(alertId)}/test`, post),
  chatDeliveries: (alertId: string) => request<Delivery[]>(`/integrations/chat-alerts/${id(alertId)}/deliveries`),

  delivery: (deliveryId: string) => request<Delivery>(`/integrations/deliveries/${id(deliveryId)}`),
  redeliver: (deliveryId: string) => request<Delivery>(`/integrations/deliveries/${id(deliveryId)}/redeliver`, post),

  sources: () => request<Source[]>('/integrations/ingestion'),
  createSource: (body: SourceInput) => request<Source>('/integrations/ingestion', jsonBody(body)),
  updateSource: (sourceId: string, body: SourceInput) => request<Source>(`/integrations/ingestion/${id(sourceId)}`, jsonBody(body, 'PUT')),
  deleteSource: (sourceId: string) => request<void>(`/integrations/ingestion/${id(sourceId)}`, del),
  testSource: (body: SourceInput & { id?: string }) => request<SourceTest>('/integrations/ingestion/test', jsonBody(body)),
  pollSource: (sourceId: string) => request<Source>(`/integrations/ingestion/${id(sourceId)}/poll`, post),

  tracking: () => request<TrackingSettings>('/integrations/tracking'),
  saveTracking: (body: TrackingInput) => request<TrackingSettings>('/integrations/tracking', jsonBody(body, 'PUT')),

  /** The public API's OpenAPI document. */
  openapi: () => request<OpenApiDocument>('/api/v1/openapi.json'),
};

/** The parts of an OpenAPI 3.1 document the reference page shows. */
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, Record<string, unknown>> };
  webhooks?: Record<string, Record<string, OpenApiOperation>>;
}
export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: Record<string, unknown> }[];
  requestBody?: { content: Record<string, { schema?: Record<string, unknown> }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Record<string, unknown> }> }>;
}

/** Where the app downloads a shipment's export (session route). */
export const exportUrl = (shipmentId: string, format: ExportFormat) => `/shipments/${id(shipmentId)}/exports/${format}`;
