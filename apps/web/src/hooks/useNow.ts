import { useState } from 'react';
import { useInterval } from './useInterval';

/** The current time, updated every `ms` while `active` (for elapsed times of running steps). */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), ms, active);
  return now;
}
