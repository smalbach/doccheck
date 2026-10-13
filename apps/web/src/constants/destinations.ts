import type { Destination } from '../api/types';

export const DESTINATION_OPTIONS: { value: Destination; label: string }[] = [
  { value: 'CA', label: 'Canada (CBSA)' },
  { value: 'US', label: 'United States (CBP)' },
];

export const DESTINATION_LABEL: Record<Destination, string> = {
  CA: 'Canada · CBSA',
  US: 'United States · CBP',
};
