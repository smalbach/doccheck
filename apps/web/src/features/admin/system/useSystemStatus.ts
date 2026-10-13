import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import type { SystemStatus } from '../../../api/types';
import { errorMessage } from '../../../lib/errorMessage';

export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    api.adminSystem().then(
      (s) => active && setStatus(s),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, []);
  return { status, error };
}
