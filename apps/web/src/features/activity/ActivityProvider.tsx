import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import type { ProgressEvent } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';
import { applyActivityEvent, EMPTY_ACTIVITY, type ActivityNames, type ActivityState } from '../../lib/activity';
import { activityAnnouncement } from '../../lib/activityAnnouncement';
import { openEventStream, type StreamConnection } from '../../lib/eventStream';
import { parseRoute } from '../../lib/parseRoute';
import { ActivityContext } from './ActivityContext';

/** Waits this long after a new id shows up before asking for names, to ask once for a batch. */
const NAMES_DELAY_MS = 250;

/**
 * The signed-in app's one user-wide progress stream (GET /events): keeps the activity state, fetches
 * the names of the shipments and documents it mentions, lets other components listen to its events
 * (useActivityEvents), and speaks start and finish milestones in a polite live region.
 */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const i18n = useI18n();
  const [state, setState] = useState<ActivityState>(EMPTY_ACTIVITY);
  const [connection, setConnection] = useState<StreamConnection>('connecting');
  const [names, setNames] = useState<ActivityNames>({ shipments: {}, documents: {} });
  const [message, setMessage] = useState('');
  const handlers = useRef(new Set<(event: ProgressEvent, live: boolean) => void>());
  const stateRef = useRef(state);
  // Read by the stream's handler, which is set up once.
  const namesRef = useRef(names);
  const i18nRef = useRef(i18n);
  useEffect(() => {
    namesRef.current = names;
    i18nRef.current = i18n;
  });

  const subscribe = useCallback((handler: (event: ProgressEvent, live: boolean) => void) => {
    handlers.current.add(handler);
    return () => void handlers.current.delete(handler);
  }, []);

  useEffect(
    () =>
      openEventStream('/events', {
        onConnection: setConnection,
        onEvent: (event, live) => {
          const next = applyActivityEvent(stateRef.current, event);
          stateRef.current = next;
          setState(next);
          for (const h of handlers.current) h(event, live);
          if (!live) return;
          // The shipment page has its own announcer for its documents and validation.
          const route = parseRoute(window.location.hash);
          if (route.name === 'shipment' && route.id === event.shipmentId) return;
          const a = activityAnnouncement(event, next, namesRef.current);
          if (a) setMessage(i18nRef.current.t(a.key, a.vars));
        },
      }),
    // One stream for as long as the signed-in app is shown.
    [],
  );

  // Names of shipments and documents not known yet (each id asked once).
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const runs = Object.values(state.runs);
    const shipments = [...new Set(runs.map((r) => r.shipmentId))].filter((id) => !asked.current.has(id));
    const documents = [...new Set(runs.map((r) => r.timeline.documentId).filter((id): id is string => !!id))].filter((id) => !asked.current.has(id));
    if (!shipments.length && !documents.length) return undefined;
    const timer = setTimeout(() => {
      for (const id of [...shipments, ...documents]) asked.current.add(id);
      api.activityLabels(shipments, documents).then(
        (labels) =>
          setNames((n) => ({
            shipments: { ...n.shipments, ...Object.fromEntries(labels.shipments.map((s) => [s.id, { reference: s.reference, destination: s.destination }])) },
            documents: { ...n.documents, ...Object.fromEntries(labels.documents.map((d) => [d.id, { fileName: d.fileName, status: d.status }])) },
          })),
        () => {
          // Asked again on the next change.
          for (const id of [...shipments, ...documents]) asked.current.delete(id);
        },
      );
    }, NAMES_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const value = useMemo(() => ({ state, connection, names, subscribe }), [state, connection, names, subscribe]);
  return (
    <ActivityContext.Provider value={value}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </ActivityContext.Provider>
  );
}
