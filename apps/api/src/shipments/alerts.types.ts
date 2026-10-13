import type { Destination } from '@doccheck/schemas';

export const ALERT_KINDS = ['critical', 'failed-document', 'ocr', 'not-validated', 'stale-destination', 'mail-reply', 'mail-overdue', 'mail-failed'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

interface AlertBase {
  shipmentId: string;
  reference?: string;
  /** When the cause happened (validation run, upload or extraction), for ordering. */
  at: string;
}

/**
 * Something on one of the user's shipments that needs a look. `detail` is machine-readable; the web
 * app builds the message.
 */
export type Alert = AlertBase &
  (
    | { kind: 'critical'; detail: { critical: number; high: number } }
    | { kind: 'failed-document'; documentId: string; fileName: string; detail: { error?: string } }
    /** `citedBy`: findings of the latest validation citing the document; 0 when the shipment was never validated. */
    | { kind: 'ocr'; documentId: string; fileName: string; detail: { citedBy: number } }
    /** `never`: extracted documents, no validation yet; `changed`: a document uploaded or re-extracted since the latest run. */
    | { kind: 'not-validated'; detail: { reason: 'never' | 'changed' } }
    | { kind: 'stale-destination'; detail: { validated: Destination; current?: Destination } }
    /** A conversation about the shipment: a reply not read yet, no answer by its due date, or a message that could not be sent. */
    | { kind: 'mail-reply' | 'mail-overdue' | 'mail-failed'; detail: { threadId: string; subject: string; count: number } }
  );

export interface AlertList {
  /** Newest first, at most `limit`. */
  items: Alert[];
  /** Every alert of each kind, also those past the limit. */
  counts: Record<AlertKind, number>;
  total: number;
}
