import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Sample, ShipmentSummary } from '../../api/types';
import { errorMessage } from '../../lib/errorMessage';

export interface HomeData {
  shipments: ShipmentSummary[];
  samples: Sample[];
  error?: string;
}

/** Recent shipments and the synthetic samples. A missing sample set is not an error. */
export function useHomeData(): HomeData {
  const [data, setData] = useState<HomeData>({ shipments: [], samples: [] });
  useEffect(() => {
    let active = true;
    api.shipments().then(
      (shipments) => active && setData((d) => ({ ...d, shipments })),
      (e: unknown) => active && setData((d) => ({ ...d, error: errorMessage(e) })),
    );
    api.samples().then(
      (samples) => active && setData((d) => ({ ...d, samples })),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  return data;
}
