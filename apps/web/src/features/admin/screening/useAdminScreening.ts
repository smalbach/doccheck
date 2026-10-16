import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { ScreeningStatus } from '../../../api/types';
import { errorMessage } from '../../../lib/errorMessage';

/** How often the page asks while the lists download. */
const POLL_MS = 5000;

/** The lists' status for admins, with refresh and thresholds; polls while a refresh runs. */
export function useAdminScreening() {
  const [status, setStatus] = useState<ScreeningStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.adminScreening().then(
      (s) => active && setStatus(s),
      (err: unknown) => active && setError(errorMessage(err)),
    );
    return () => {
      active = false;
    };
  }, []);

  const refreshing = !!status?.refreshing;
  useEffect(() => {
    if (!refreshing) return;
    const timer = setInterval(() => {
      api.adminScreening().then(setStatus, () => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshing]);

  /** Runs an action that answers with the status; resolves to whether it worked. */
  const run = useCallback(async (action: () => Promise<ScreeningStatus>) => {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await action());
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    error,
    busy,
    refresh: () => run(() => api.refreshScreening()),
    saveThresholds: (t: { match: number; review: number }) => run(() => api.setScreeningThresholds(t)),
    resetThresholds: () => run(() => api.resetScreeningThresholds()),
  };
}
