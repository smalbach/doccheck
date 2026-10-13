import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { AdminModels, AdminSettings, SettingKey, SettingValues } from '../../../api/types';
import { errorMessage } from '../../../lib/errorMessage';

export type SettingsStatus = { tone: 'ok' | 'error'; text: string } | undefined;

/** Settings and installed models, with save and reset; `status` carries the last outcome. */
export function useAdminSettings(savedMessage: string) {
  const [settings, setSettings] = useState<AdminSettings>();
  const [models, setModels] = useState<AdminModels>();
  const [status, setStatus] = useState<SettingsStatus>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.adminSettings().then(
      (s) => active && setSettings(s),
      (e: unknown) => active && setStatus({ tone: 'error', text: errorMessage(e) }),
    );
    api.adminModels().then(
      (m) => active && setModels(m),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<AdminSettings>) => {
      setBusy(true);
      setStatus(undefined);
      try {
        setSettings(await action());
        setStatus({ tone: 'ok', text: savedMessage });
        api.adminModels().then(setModels, () => undefined);
      } catch (e) {
        setStatus({ tone: 'error', text: errorMessage(e) });
      } finally {
        setBusy(false);
      }
    },
    [savedMessage],
  );

  const save = useCallback((values: Partial<SettingValues>) => run(() => api.updateSettings(values)), [run]);
  const reset = useCallback((key: SettingKey) => run(() => api.resetSetting(key)), [run]);

  return { settings, models, status, busy, save, reset };
}
