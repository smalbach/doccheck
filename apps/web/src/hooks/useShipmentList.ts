import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ShipmentSummary } from '../api/types';
import { errorMessage } from '../lib/errorMessage';

/** The signed-in user's shipments, most recent first. */
export function useShipmentList() {
  const [shipments, setShipments] = useState<ShipmentSummary[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    api.shipments().then(
      (list) => active && setShipments(list),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, []);
  return { shipments, error };
}
