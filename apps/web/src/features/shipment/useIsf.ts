import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { IsfFiling } from '../../api/types';

/** The shipment's ISF: undefined while loading, null when there is none. Reloaded when `version` changes. */
export function useIsf(shipmentId: string, version: string) {
  const [isf, setIsf] = useState<IsfFiling | null>();
  useEffect(() => {
    let active = true;
    api.isf(shipmentId).then(
      (value) => active && setIsf(value),
      () => active && setIsf(null),
    );
    return () => {
      active = false;
    };
  }, [shipmentId, version]);
  return [isf, setIsf] as const;
}
