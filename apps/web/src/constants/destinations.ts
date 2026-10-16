import type { Destination } from '../api/types';
import type { MessageKey } from '../i18n/keys';

export const DESTINATIONS: readonly Destination[] = ['CA', 'US', 'MX', 'EU', 'GB'];

/** "Canada (CBSA)" in forms and filters. */
export const DESTINATION_OPTION_KEY: Record<Destination, MessageKey> = {
  CA: 'destinations.CA',
  US: 'destinations.US',
  MX: 'destinations.MX',
  EU: 'destinations.EU',
  GB: 'destinations.GB',
};

/** "Canada · CBSA" under a shipment's title. */
export const DESTINATION_LABEL_KEY: Record<Destination, MessageKey> = {
  CA: 'destinations.long.CA',
  US: 'destinations.long.US',
  MX: 'destinations.long.MX',
  EU: 'destinations.long.EU',
  GB: 'destinations.long.GB',
};
