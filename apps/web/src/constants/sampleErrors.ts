import type { MessageKey } from '../i18n/keys';

export type SampleFilter = 'all' | 'CA' | 'US' | 'clean';

export const SAMPLE_FILTERS: readonly { value: SampleFilter; labelKey: MessageKey }[] = [
  { value: 'all', labelKey: 'samples.filters.all' },
  { value: 'CA', labelKey: 'samples.filters.CA' },
  { value: 'US', labelKey: 'samples.filters.US' },
  { value: 'clean', labelKey: 'samples.filters.clean' },
];

/** How many sample cards to show before "Show more". */
export const SAMPLE_PAGE_SIZE = 24;
