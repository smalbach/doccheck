import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { Role, UserSummary } from '../../../api/types';
import { errorMessage } from '../../../lib/errorMessage';

export function useAdminUsers() {
  const [users, setUsers] = useState<UserSummary[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    let active = true;
    api.adminUsers().then(
      (list) => active && setUsers(list),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, []);

  /** Resolves true when the change went through. */
  const setRole = useCallback(async (id: string, role: Role) => {
    setBusy(id);
    setError(undefined);
    try {
      setUsers(await api.setRole(id, role));
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(undefined);
    }
  }, []);

  return { users, error, busy, setRole };
}
