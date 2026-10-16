import { useSyncExternalStore } from 'react';
import type { DestinationFilter } from '../constants/shipmentFilters';

export interface AnalyticsFilterState {
  destination: DestinationFilter;
  /** YYYY-MM-DD, both days included; empty for no bound. */
  from: string;
  to: string;
}

// One filter for every analytics page, so moving from the KPIs to the scorecard keeps it.
let current: AnalyticsFilterState = { destination: 'any', from: '', to: '' };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useAnalyticsFilter(): [AnalyticsFilterState, (patch: Partial<AnalyticsFilterState>) => void] {
  const value = useSyncExternalStore(subscribe, () => current);
  const set = (patch: Partial<AnalyticsFilterState>) => {
    current = { ...current, ...patch };
    listeners.forEach((l) => l());
  };
  return [value, set];
}
