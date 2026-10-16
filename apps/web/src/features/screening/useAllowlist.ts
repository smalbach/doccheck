import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AllowlistItem } from '../../api/types';
import { errorMessage } from '../../lib/errorMessage';

/** The account's allowlist (every account's with `all`), with or without removed entries. */
export function useAllowlist(all = false) {
  const [items, setItems] = useState<AllowlistItem[]>();
  const [history, setHistory] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setItems(await api.screeningAllowlist({ history, all }));
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [history, all]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (item: AllowlistItem) => {
      try {
        await api.removeAllowlist(item.id);
        await load();
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      }
    },
    [load],
  );

  return { items, error, history, setHistory, reload: load, remove };
}
