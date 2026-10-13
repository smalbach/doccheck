import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { MailSummary } from '../api/types';

const POLL_MS = 30_000;

// One poll for the whole app (sidebar badge, inbox, dashboard); a page that changed something calls refreshMailSummary.
let current: MailSummary | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let users = 0;

export function refreshMailSummary(): void {
  api.mailSummary().then(
    (s) => {
      current = s;
      listeners.forEach((l) => l());
    },
    () => undefined,
  );
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Unread replies and the rest of the mail summary, refreshed every 30 s while something shows it. */
export function useMailSummary(enabled = true): MailSummary | undefined {
  const value = useSyncExternalStore(subscribe, () => current);
  useEffect(() => {
    if (!enabled) return;
    if (users++ === 0) {
      refreshMailSummary();
      timer = setInterval(refreshMailSummary, POLL_MS);
    }
    return () => {
      if (--users === 0) clearInterval(timer);
    };
  }, [enabled]);
  return enabled ? value : undefined;
}
