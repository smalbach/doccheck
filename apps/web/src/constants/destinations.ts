import type { Destination } from '../api/types';
import type { MessageKey } from '../i18n/keys';

export const DESTINATIONS: readonly Destination[] = ['CA', 'US'];

/** "Canada (CBSA)" in forms and filters. */
export const DESTINATION_OPTION_KEY: Record<Destination, MessageKey> = { CA: 'destinations.CA', US: 'destinations.US' };

/** "Canada · CBSA" under a shipment's title. */
export const DESTINATION_LABEL_KEY: Record<Destination, MessageKey> = { CA: 'destinations.long.CA', US: 'destinations.long.US' };
