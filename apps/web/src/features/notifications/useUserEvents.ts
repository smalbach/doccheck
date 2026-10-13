import { useEffect, useRef } from 'react';
import type { ProgressEvent } from '../../api/types';

/** Waits between reconnections after the server refused or ended the stream; the last one repeats. */
const RETRY_MS = [1000, 3000, 10_000, 30_000];

/**
 * Every progress event of the signed-in user's shipments, from GET /events (server-sent events).
 * `onEvent` gets `live` false for the backlog sent on (re)connection, true after the stream's `ready`.
 * The browser reconnects on its own after Last-Event-ID; when the server refuses or closes the stream,
 * a new one opens with ?after= the last event seen. Nothing happens without EventSource.
 */
export function useUserEvents(onEvent: (event: ProgressEvent, live: boolean) => void): void {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let lastId = 0;
    let ready = false;

    const open = () => {
      ready = false;
      const es = new EventSource(`/events${lastId ? `?after=${lastId}` : ''}`);
      source = es;
      es.onmessage = (m: MessageEvent<string>) => {
        let event: ProgressEvent;
        try {
          event = JSON.parse(m.data) as ProgressEvent;
        } catch {
          return;
        }
        lastId = Math.max(lastId, event.id);
        handler.current(event, ready);
      };
      es.addEventListener('ready', () => {
        ready = true;
        failures = 0;
      });
      es.onerror = () => {
        ready = false;
        failures += 1;
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
  }, []);
}
