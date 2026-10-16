import { useEffect, useState } from 'react';
import { analyticsApi } from '../api/analytics';

const READ_EVENT = 'doccheck:regulations-read';
/** How often the sidebar asks again (changes come from a daily check, so rarely). */
const POLL_MS = 10 * 60_000;

/** Tells the sidebar badge that the changes page was opened. */
export const notifyRegulationsRead = () => window.dispatchEvent(new Event(READ_EVENT));

/** Regulation changes the user has not seen yet, for the sidebar badge; undefined while unknown or off. */
export function useRegulationsUnread(enabled: boolean): number | undefined {
  const [unread, setUnread] = useState<number>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => analyticsApi.regulationsUnread().then((r) => active && setUnread(r.unread), () => undefined);
    void load();
    const timer = setInterval(load, POLL_MS);
    const onRead = () => setUnread(0);
    window.addEventListener(READ_EVENT, onRead);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(READ_EVENT, onRead);
    };
  }, [enabled]);
  return unread;
}
