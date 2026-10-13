import type { ShipmentSummary } from '../api/types';
import type { MessageKey } from '../i18n/keys';

export type StatusFilter = 'all' | 'open' | 'attention' | 'done';

export const STATUS_FILTERS: readonly { value: StatusFilter; labelKey: MessageKey }[] = [
  { value: 'all', labelKey: 'shipments.statusFilters.all' },
  { value: 'open', labelKey: 'shipments.statusFilters.open' },
  { value: 'attention', labelKey: 'shipments.statusFilters.attention' },
  { value: 'done', labelKey: 'shipments.statusFilters.done' },
];

export type DestinationFilter = 'any' | 'CA' | 'US';

export const DESTINATION_FILTERS: readonly { value: DestinationFilter; labelKey: MessageKey }[] = [
  { value: 'any', labelKey: 'shipments.anyDestination' },
  { value: 'CA', labelKey: 'destinations.CA' },
  { value: 'US', labelKey: 'destinations.US' },
];

/** Not validated yet, or being worked on. */
export const OPEN_STATUSES: ReadonlySet<ShipmentSummary['status']> = new Set(['RECEIVED', 'EXTRACTING', 'VALIDATING']);
