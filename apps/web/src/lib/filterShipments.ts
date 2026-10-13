import type { ShipmentSummary } from '../api/types';
import { OPEN_STATUSES, type DestinationFilter, type StatusFilter } from '../constants/shipmentFilters';
import { needsAttention } from './needsAttention';

export interface ShipmentFilterState {
  status: StatusFilter;
  destination: DestinationFilter;
  query: string;
}

/** Shipments matching the status group, destination and reference/ID text. */
export function filterShipments(shipments: readonly ShipmentSummary[], { status, destination, query }: ShipmentFilterState): ShipmentSummary[] {
  const q = query.trim().toLowerCase();
  return shipments.filter((s) => {
    if (destination !== 'any' && s.destination !== destination) return false;
    if (q && !`${s.reference ?? ''} ${s.id}`.toLowerCase().includes(q)) return false;
    switch (status) {
      case 'open':
        return OPEN_STATUSES.has(s.status);
      case 'attention':
        return needsAttention(s);
      case 'done':
        return s.status === 'DONE' && s.findingCount === 0;
      case 'all':
        return true;
    }
  });
}
