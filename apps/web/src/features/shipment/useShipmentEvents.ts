import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '../../api/types';
import { applyEvent, EMPTY_PROGRESS, type ProgressState } from '../../lib/progressTimeline';

/**
 * open: the stream is up and its backlog was received. connecting: (re)connecting. fallback: the
 * stream keeps failing (or EventSource is missing): callers poll instead, and it is still retried.
 */
export type EventsConnection = 'connecting' | 'open' | 'fallback';

/** Waits between reconnections after the server refused or ended the stream; the last one repeats. */
const RETRY_MS = [1000, 3000, 10_000, 30_000];
/** Failed (re)connections in a row before callers fall back to polling. */
const FALLBACK_AFTER = 2;

export interface ShipmentEvents {
  progress: ProgressState;
  connection: EventsConnection;
  /** The latest event that arrived live (not from the backlog), for announcements. */
  lastLive?: ProgressEvent;
}

/**
 * Live progress of a shipment from GET /shipments/:id/events (server-sent events). The browser
 * reconnects on its own and resumes after Last-Event-ID; when the server refuses or closes the stream,
 * a new one opens with ?after= the last event seen. `onEvent` gets every event, `live` false for the
 * backlog sent on (re)connection.
 */
export function useShipmentEvents(shipmentId: string, onEvent?: (event: ProgressEvent, live: boolean) => void): ShipmentEvents {
  const [progress, setProgress] = useState<ProgressState>(EMPTY_PROGRESS);
  const [connection, setConnection] = useState<EventsConnection>('connecting');
  const [lastLive, setLastLive] = useState<ProgressEvent>();
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    setProgress(EMPTY_PROGRESS);
    setLastLive(undefined);
    if (typeof EventSource === 'undefined') {
      setConnection('fallback');
      return undefined;
    }
    setConnection('connecting');
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let lastId = 0;
    let ready = false;

    const open = () => {
      ready = false;
      const es = new EventSource(`/shipments/${encodeURIComponent(shipmentId)}/events${lastId ? `?after=${lastId}` : ''}`);
      source = es;
      es.onmessage = (m: MessageEvent<string>) => {
        let event: ProgressEvent;
        try {
          event = JSON.parse(m.data) as ProgressEvent;
        } catch {
          return;
        }
        lastId = Math.max(lastId, event.id);
        setProgress((s) => applyEvent(s, event));
        if (ready) setLastLive(event);
        handler.current?.(event, ready);
      };
      es.addEventListener('ready', () => {
        ready = true;
        failures = 0;
        setConnection('open');
      });
      es.onerror = () => {
        ready = false;
        failures += 1;
        if (failures >= FALLBACK_AFTER) setConnection('fallback');
        else setConnection('connecting');
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
  }, [shipmentId]);

  return { progress, connection, lastLive };
}
