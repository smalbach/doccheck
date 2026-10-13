import { useSyncExternalStore } from 'react';
import type { DestinationFilter } from '../constants/shipmentFilters';

// One destination filter for every data page, so moving from companies to products keeps it.
let current: DestinationFilter = 'any';
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useDataDestination(): [DestinationFilter, (value: DestinationFilter) => void] {
  const value = useSyncExternalStore(subscribe, () => current);
  const set = (next: DestinationFilter) => {
    current = next;
    listeners.forEach((l) => l());
  };
  return [value, set];
}
