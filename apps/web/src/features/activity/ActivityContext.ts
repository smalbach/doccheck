import { createContext, useContext, useEffect, useRef } from 'react';
import type { ProgressEvent } from '../../api/types';
import { EMPTY_ACTIVITY, type ActivityNames, type ActivityState } from '../../lib/activity';
import type { StreamConnection } from '../../lib/eventStream';

export interface ActivityContextValue {
  state: ActivityState;
  connection: StreamConnection;
  names: ActivityNames;
  /** Every event of the user-wide stream (`live` false for the backlog). Returns the unsubscribe function. */
  subscribe: (handler: (event: ProgressEvent, live: boolean) => void) => () => void;
}

export const ActivityContext = createContext<ActivityContextValue>({
  state: EMPTY_ACTIVITY,
  connection: 'connecting',
  names: { shipments: {}, documents: {} },
  subscribe: () => () => undefined,
});

/** The user's activity (runs in progress and recently finished) from the app's one user-wide stream. */
export const useActivity = (): ActivityContextValue => useContext(ActivityContext);

/** Calls `handler` for every event of the user-wide stream, without opening another one. */
export function useActivityEvents(handler: (event: ProgressEvent, live: boolean) => void): void {
  const { subscribe } = useActivity();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  }, [handler]);
  useEffect(() => subscribe((e, live) => latest.current(e, live)), [subscribe]);
}
