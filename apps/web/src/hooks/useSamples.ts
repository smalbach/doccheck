import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Sample } from '../api/types';

/** The synthetic samples; an empty list when the set is not there. */
export function useSamples() {
  const [samples, setSamples] = useState<Sample[]>();
  useEffect(() => {
    let active = true;
    api.samples().then(
      (list) => active && setSamples(list),
      () => active && setSamples([]),
    );
    return () => {
      active = false;
    };
  }, []);
  return samples;
}
