import { useState } from 'react';
import type { Shipment } from '../api/types';
import { errorMessage } from '../lib/errorMessage';
import { navigate } from '../lib/navigate';

/** Runs one action that yields a shipment and opens it; `busy` names the action in flight. */
export function useOpenShipment() {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  const open = async (key: string, action: () => Promise<Shipment>) => {
    setBusy(key);
    setError(undefined);
    try {
      const shipment = await action();
      navigate(`/app/s/${shipment.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(undefined);
    }
  };

  return { busy, error, open };
}
