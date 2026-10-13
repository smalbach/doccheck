import type { DocumentType } from '../api/types';
import type { MessageKey } from '../i18n/keys';

/** Types a document can be extracted as (re-extraction picks one of these). */
export type ExtractableType = Exclude<DocumentType, 'UNKNOWN'>;

export const DOCUMENT_TYPE_KEY: Record<DocumentType, MessageKey> = {
  COMMERCIAL_INVOICE: 'documentTypes.COMMERCIAL_INVOICE',
  PACKING_LIST: 'documentTypes.PACKING_LIST',
  BILL_OF_LADING: 'documentTypes.BILL_OF_LADING',
  ISF: 'documentTypes.ISF',
  UNKNOWN: 'documentTypes.UNKNOWN',
};

export const EXTRACTABLE_TYPES: readonly { value: ExtractableType; labelKey: MessageKey }[] = [
  { value: 'COMMERCIAL_INVOICE', labelKey: 'documentTypes.COMMERCIAL_INVOICE' },
  { value: 'PACKING_LIST', labelKey: 'documentTypes.PACKING_LIST' },
  { value: 'BILL_OF_LADING', labelKey: 'documentTypes.BILL_OF_LADING' },
  { value: 'ISF', labelKey: 'documentTypes.ISF_LONG' },
];
