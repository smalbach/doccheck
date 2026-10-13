import type { ShipmentSummary } from '../api/types';
import { OPEN_STATUSES } from '../constants/shipmentFilters';
import { needsAttention } from './needsAttention';

export interface ShipmentTotals {
  total: number;
  inProgress: number;
  attention: number;
  clean: number;
  findings: number;
}

/** Counts for the dashboard. */
export function summarizeShipments(shipments: readonly ShipmentSummary[]): ShipmentTotals {
  return {
    total: shipments.length,
    inProgress: shipments.filter((s) => OPEN_STATUSES.has(s.status)).length,
    attention: shipments.filter(needsAttention).length,
    clean: shipments.filter((s) => s.status === 'DONE' && s.findingCount === 0).length,
    findings: shipments.reduce((n, s) => n + (s.findingCount ?? 0), 0),
  };
}
