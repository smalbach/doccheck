import type { Destination, StatusGroup } from '../api/types';
import type { MessageKey } from '../i18n/keys';
import { DESTINATION_OPTION_KEY, DESTINATIONS } from './destinations';

export type StatusFilter = StatusGroup;

export const STATUS_FILTERS: readonly { value: StatusFilter; labelKey: MessageKey }[] = [
  { value: 'all', labelKey: 'shipments.statusFilters.all' },
  { value: 'open', labelKey: 'shipments.statusFilters.open' },
  { value: 'attention', labelKey: 'shipments.statusFilters.attention' },
  { value: 'done', labelKey: 'shipments.statusFilters.done' },
];

export type DestinationFilter = 'any' | Destination;

export const DESTINATION_FILTERS: readonly { value: DestinationFilter; labelKey: MessageKey }[] = [
  { value: 'any', labelKey: 'shipments.anyDestination' },
  ...DESTINATIONS.map((d) => ({ value: d, labelKey: DESTINATION_OPTION_KEY[d] })),
];

export interface ShipmentFilterState {
  status: StatusFilter;
  destination: DestinationFilter;
  query: string;
}

export const INITIAL_SHIPMENT_FILTERS: ShipmentFilterState = { status: 'all', destination: 'any', query: '' };

export const SHIPMENTS_PAGE_SIZE = 25;

/** Wait after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 300;
