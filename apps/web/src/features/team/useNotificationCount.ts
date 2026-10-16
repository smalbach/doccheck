import { useEffect, useSyncExternalStore } from 'react';
import { teamApi } from '../../api/teamClient';

const POLL_MS = 30_000;

// One poll for the whole app, like the mail summary; the notifications page refreshes it after reading.
let current: number | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let users = 0;

export function refreshNotificationCount(): void {
  teamApi.notifications(true).then(
    (r) => {
      current = r.unread;
      listeners.forEach((l) => l());
    },
    () => undefined,
  );
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Unread notifications (mentions, assignments, approvals), refreshed every 30 s while shown. */
export function useNotificationCount(enabled = true): number | undefined {
  const value = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!enabled) return;
    if (users++ === 0) {
      refreshNotificationCount();
      timer = setInterval(refreshNotificationCount, POLL_MS);
    }
    return () => {
      if (--users === 0) clearInterval(timer);
    };
  }, [enabled]);
  return enabled ? value : undefined;
}
