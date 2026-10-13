import { ProgressEventSchema, type ProgressEvent } from '@doccheck/schemas';

/** A NOTIFY payload: the whole event, or only its id when the event was too large. */
export function parseNotification(payload: string): ProgressEvent | { id: number } | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  const event = ProgressEventSchema.safeParse(value);
  if (event.success) return event.data as ProgressEvent;
  const id = (value as { id?: unknown } | null)?.id;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? { id } : null;
}

/**
 * One SSE message: `id:` is the event id (sent back as Last-Event-ID on reconnect), data is the JSON
 * event. An ephemeral event has no `id:` line, so the client's resume position stays where it was.
 */
export const sseEvent = (event: ProgressEvent): string => `${event.ephemeral ? '' : `id: ${event.id}\n`}data: ${JSON.stringify(event)}\n\n`;

/** A named message without an id, e.g. `ready` once the backlog has been sent. */
export const sseNamed = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** A comment line: keeps proxies and the browser from timing the connection out. */
export const SSE_HEARTBEAT = ': ping\n\n';

/**
 * Where to resume: the Last-Event-ID header (sent by EventSource on its own reconnects) wins over
 * ?after= (used by a client that opens a new EventSource). undefined: the client has nothing yet.
 */
export function resumeAfter(lastEventId: string | string[] | undefined, after: unknown): number | undefined {
  for (const v of [Array.isArray(lastEventId) ? lastEventId[0] : lastEventId, typeof after === 'string' ? after : undefined]) {
    if (v !== undefined && /^\d{1,15}$/.test(v.trim())) return Number(v.trim());
  }
  return undefined;
}
