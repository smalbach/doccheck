import type { ShipmentSummary } from '../api/types';

export type StatusFilter = 'all' | 'open' | 'attention' | 'done';

export const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'In progress' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'done', label: 'Clean' },
];

export type DestinationFilter = 'any' | 'CA' | 'US';

export const DESTINATION_FILTERS: { value: DestinationFilter; label: string }[] = [
  { value: 'any', label: 'Any destination' },
  { value: 'CA', label: 'Canada (CBSA)' },
  { value: 'US', label: 'United States (CBP)' },
];

/** Not validated yet, or being worked on. */
export const OPEN_STATUSES: ReadonlySet<ShipmentSummary['status']> = new Set(['RECEIVED', 'EXTRACTING', 'VALIDATING']);
