/** Short labels for the error kinds the synthetic generator injects. */
export const SAMPLE_ERROR_LABEL: Record<string, string> = {
  package_count_mismatch: 'Package count',
  gross_weight_mismatch: 'Gross weight',
  net_exceeds_gross: 'Net > gross',
  line_quantity_changed: 'Quantity',
  line_total_typo: 'Line total',
  second_currency: 'Currency',
  container_check_digit: 'Container no.',
  consignee_address_mismatch: 'Consignee address',
  packing_list_quantity_mismatch: 'Packing list qty',
  missing_required_field: 'Missing field',
};

export type SampleFilter = 'all' | 'CA' | 'US' | 'clean';

export const SAMPLE_FILTERS: { value: SampleFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'CA', label: 'CA' },
  { value: 'US', label: 'US' },
  { value: 'clean', label: 'No errors' },
];

/** How many sample cards to show before "Show more". */
export const SAMPLE_PAGE_SIZE = 24;
