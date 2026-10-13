import type { DocumentType } from '../api/types';

/** Types a document can be extracted as (re-extraction picks one of these). */
export type ExtractableType = Exclude<DocumentType, 'UNKNOWN'>;

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  COMMERCIAL_INVOICE: 'Commercial invoice',
  PACKING_LIST: 'Packing list',
  BILL_OF_LADING: 'Bill of lading',
  ISF: 'ISF',
  UNKNOWN: 'Unknown',
};

export const EXTRACTABLE_TYPES: { value: ExtractableType; label: string }[] = [
  { value: 'COMMERCIAL_INVOICE', label: 'Commercial invoice' },
  { value: 'PACKING_LIST', label: 'Packing list' },
  { value: 'BILL_OF_LADING', label: 'Bill of lading' },
  { value: 'ISF', label: 'ISF (10+2)' },
];
