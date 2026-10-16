import type { Severity } from '@doccheck/schemas';

/** Events an account can subscribe to with a webhook or a chat alert. `ping` is the test send only. */
export const EVENT_TYPES = ['document.extracted', 'validation.completed', 'finding.created', 'finding.resolved', 'supplier.replied'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type DeliveredEventType = EventType | 'ping';

export interface ShipmentRef {
  id: string;
  reference: string | null;
  /** Link to the shipment in the web app. */
  url: string;
}

export interface FindingRef {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  message: string;
}

export interface EventData {
  'document.extracted': { shipment: ShipmentRef; document: { id: string; fileName: string; type: string; normalized: boolean; pages: number | null } };
  'validation.completed': { shipment: ShipmentRef; validation: { id: string; findings: number; skipped: number; bySeverity: Partial<Record<Severity, number>> } };
  'finding.created': { shipment: ShipmentRef; validationId: string; finding: FindingRef };
  'finding.resolved': { shipment: ShipmentRef; validationId: string; finding: FindingRef };
  'supplier.replied': { shipment: ShipmentRef | null; thread: { id: string; subject: string; url: string }; message: { id: string; from: string; receivedAt: string; attachments: number } };
  ping: { message: string };
}

/** The JSON body of a webhook delivery. */
export interface WebhookEvent<T extends DeliveredEventType = DeliveredEventType> {
  id: string;
  type: T;
  createdAt: string;
  data: EventData[T];
}

export const isEventType = (v: string): v is EventType => (EVENT_TYPES as readonly string[]).includes(v);
