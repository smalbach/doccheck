import type { ProgressEvent } from '../api/types';

/**
 * open: the stream is up and its backlog was received. connecting: (re)connecting. fallback: the
 * stream keeps failing (or EventSource is missing): callers poll instead, and it is still retried.
 */
export type StreamConnection = 'connecting' | 'open' | 'fallback';

/** Waits between reconnections after the server refused or ended the stream; the last one repeats. */
const RETRY_MS = [1000, 3000, 10_000, 30_000];
/** Failed (re)connections in a row before callers fall back to polling. */
const FALLBACK_AFTER = 2;

export interface StreamHandlers {
  /** Every progress event; `live` is false for the backlog sent on (re)connection. */
  onEvent: (event: ProgressEvent, live: boolean) => void;
  onConnection: (connection: StreamConnection) => void;
}

/**
 * Opens a progress stream (server-sent events, docs/PROGRESS-EVENTS.md) and keeps it open: the browser
 * reconnects on its own with Last-Event-ID; when the server refuses or ends the stream, a new one opens
 * with ?after= the last event seen. Returns a function that closes it.
 */
export function openEventStream(path: string, { onEvent, onConnection }: StreamHandlers): () => void {
  if (typeof EventSource === 'undefined') {
    onConnection('fallback');
    return () => undefined;
  }
  onConnection('connecting');
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let lastId = 0;
  let ready = false;

  const open = () => {
    ready = false;
    const es = new EventSource(`${path}${lastId ? `${path.includes('?') ? '&' : '?'}after=${lastId}` : ''}`);
    source = es;
    es.onmessage = (m: MessageEvent<string>) => {
      let event: ProgressEvent;
      try {
        event = JSON.parse(m.data) as ProgressEvent;
      } catch {
        return;
      }
      lastId = Math.max(lastId, event.id);
      onEvent(event, ready);
    };
    es.addEventListener('ready', () => {
      ready = true;
      failures = 0;
      onConnection('open');
    });
    es.onerror = () => {
      ready = false;
      failures += 1;
      onConnection(failures >= FALLBACK_AFTER ? 'fallback' : 'connecting');
      // CONNECTING: the browser retries by itself (with Last-Event-ID). CLOSED: it gave up; open a new one.
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        timer = setTimeout(open, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
      }
    };
  };
  open();
  return () => {
    clearTimeout(timer);
    source?.close();
  };
}
