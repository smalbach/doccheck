import type { DocumentType } from '../api/types';
import type { MessageKey } from '../i18n/keys';

/** Types a document can be extracted as (re-extraction picks one of these). */
export type ExtractableType = Exclude<DocumentType, 'UNKNOWN'>;

export const DOCUMENT_TYPE_KEY: Record<DocumentType, MessageKey> = {
  COMMERCIAL_INVOICE: 'documentTypes.COMMERCIAL_INVOICE',
  PACKING_LIST: 'documentTypes.PACKING_LIST',
  BILL_OF_LADING: 'documentTypes.BILL_OF_LADING',
  ISF: 'documentTypes.ISF',
  AIR_WAYBILL: 'documentTypes.AIR_WAYBILL',
  CERTIFICATE_OF_ORIGIN: 'documentTypes.CERTIFICATE_OF_ORIGIN',
  CUSMA_CERTIFICATION: 'documentTypes.CUSMA_CERTIFICATION',
  ARRIVAL_NOTICE: 'documentTypes.ARRIVAL_NOTICE',
  WOOD_PACKAGING_CERTIFICATE: 'documentTypes.WOOD_PACKAGING_CERTIFICATE',
  DANGEROUS_GOODS_DECLARATION: 'documentTypes.DANGEROUS_GOODS_DECLARATION',
  UNKNOWN: 'documentTypes.UNKNOWN',
};

export const EXTRACTABLE_TYPES: readonly { value: ExtractableType; labelKey: MessageKey }[] = [
  { value: 'COMMERCIAL_INVOICE', labelKey: 'documentTypes.COMMERCIAL_INVOICE' },
  { value: 'PACKING_LIST', labelKey: 'documentTypes.PACKING_LIST' },
  { value: 'BILL_OF_LADING', labelKey: 'documentTypes.BILL_OF_LADING' },
  { value: 'ISF', labelKey: 'documentTypes.ISF_LONG' },
  { value: 'AIR_WAYBILL', labelKey: 'documentTypes.AIR_WAYBILL' },
  { value: 'CERTIFICATE_OF_ORIGIN', labelKey: 'documentTypes.CERTIFICATE_OF_ORIGIN' },
  { value: 'CUSMA_CERTIFICATION', labelKey: 'documentTypes.CUSMA_CERTIFICATION' },
  { value: 'ARRIVAL_NOTICE', labelKey: 'documentTypes.ARRIVAL_NOTICE' },
  { value: 'WOOD_PACKAGING_CERTIFICATE', labelKey: 'documentTypes.WOOD_PACKAGING_CERTIFICATE' },
  { value: 'DANGEROUS_GOODS_DECLARATION', labelKey: 'documentTypes.DANGEROUS_GOODS_DECLARATION' },
];
