import type { ShipmentSummary } from '../api/types';

/** Validated with findings, or missing a document a rule needs. */
export function needsAttention(s: ShipmentSummary): boolean {
  return s.status === 'NEEDS_INPUT' || (s.findingCount ?? 0) > 0;
}
