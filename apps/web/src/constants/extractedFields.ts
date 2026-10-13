import type { DocumentType } from '../api/types';
import type { MessageKey } from '../i18n/keys';

export interface FieldSpec {
  labelKey: MessageKey;
  /** Dot path into the normalized document. */
  path: string;
}

/** Key fields shown per document type. */
export const EXTRACTED_FIELDS: Partial<Record<DocumentType, FieldSpec[]>> = {
  COMMERCIAL_INVOICE: [
    { labelKey: 'extracted.fields.invoiceNumber', path: 'invoiceNumber' },
    { labelKey: 'extracted.fields.invoiceDate', path: 'invoiceDate' },
    { labelKey: 'extracted.fields.po', path: 'poNumber' },
    { labelKey: 'extracted.fields.seller', path: 'seller.name' },
    { labelKey: 'extracted.fields.buyer', path: 'buyer.name' },
    { labelKey: 'extracted.fields.consignee', path: 'consignee.name' },
    { labelKey: 'extracted.fields.shipmentDate', path: 'shipmentDate' },
    { labelKey: 'extracted.fields.terms', path: 'incoterm.code' },
    { labelKey: 'extracted.fields.currency', path: 'currency' },
    { labelKey: 'extracted.fields.packages', path: 'packageCount' },
    { labelKey: 'extracted.fields.netWeight', path: 'netWeight.kg' },
    { labelKey: 'extracted.fields.grossWeight', path: 'grossWeight.kg' },
    { labelKey: 'extracted.fields.invoiceTotal', path: 'invoiceTotal.amount' },
    { labelKey: 'extracted.fields.portOfEntry', path: 'portOfEntry.name' },
  ],
  PACKING_LIST: [
    { labelKey: 'extracted.fields.packingListNumber', path: 'packingListNumber' },
    { labelKey: 'extracted.fields.invoiceRef', path: 'invoiceRef' },
    { labelKey: 'extracted.fields.consignee', path: 'consignee.name' },
    { labelKey: 'extracted.fields.packages', path: 'totals.packageCount' },
    { labelKey: 'extracted.fields.netWeight', path: 'totals.netWeight.kg' },
    { labelKey: 'extracted.fields.grossWeight', path: 'totals.grossWeight.kg' },
    { labelKey: 'extracted.fields.volume', path: 'totals.volumeM3' },
  ],
  BILL_OF_LADING: [
    { labelKey: 'extracted.fields.blNumber', path: 'blNumber' },
    { labelKey: 'extracted.fields.carrier', path: 'carrier.name' },
    { labelKey: 'extracted.fields.shipper', path: 'shipper.name' },
    { labelKey: 'extracted.fields.consignee', path: 'consignee.name' },
    { labelKey: 'extracted.fields.vessel', path: 'vessel' },
    { labelKey: 'extracted.fields.portOfLoading', path: 'portOfLoading.name' },
    { labelKey: 'extracted.fields.portOfDischarge', path: 'portOfDischarge.name' },
    { labelKey: 'extracted.fields.onBoard', path: 'shippedOnBoardDate' },
    { labelKey: 'extracted.fields.packages', path: 'totalPackages' },
    { labelKey: 'extracted.fields.grossWeight', path: 'totalGrossWeight.kg' },
    { labelKey: 'extracted.fields.freight', path: 'freightTerms' },
  ],
  ISF: [
    { labelKey: 'extracted.fields.importerNumber', path: 'importerOfRecordNumber' },
    { labelKey: 'extracted.fields.consigneeNumber', path: 'consigneeNumber' },
    { labelKey: 'extracted.fields.seller', path: 'seller.name' },
    { labelKey: 'extracted.fields.buyer', path: 'buyer.name' },
    { labelKey: 'extracted.fields.manufacturer', path: 'manufacturer.name' },
    { labelKey: 'extracted.fields.shipTo', path: 'shipToParty.name' },
    { labelKey: 'extracted.fields.origin', path: 'countryOfOrigin' },
    { labelKey: 'extracted.fields.hts', path: 'htsCode' },
    { labelKey: 'extracted.fields.stuffing', path: 'containerStuffingLocation.city' },
    { labelKey: 'extracted.fields.consolidator', path: 'consolidator.name' },
  ],
};

/** Fields of each commercial invoice line that can be corrected by hand, relative to the line. */
export const INVOICE_LINE_FIELDS: FieldSpec[] = [
  { labelKey: 'extracted.columns.description', path: 'description' },
  { labelKey: 'extracted.columns.sku', path: 'sku' },
  { labelKey: 'extracted.columns.quantity', path: 'quantity.value' },
  { labelKey: 'extracted.columns.unit', path: 'quantity.unit' },
  { labelKey: 'extracted.columns.unitPrice', path: 'unitPrice.amount' },
  { labelKey: 'extracted.columns.total', path: 'lineTotal.amount' },
  { labelKey: 'extracted.columns.origin', path: 'countryOfOrigin' },
  { labelKey: 'extracted.columns.hs', path: 'hsCode' },
];

/** Column headings of the line table per document type (the first column is the row label). */
export const EXTRACTED_ROW_HEADINGS: Partial<Record<DocumentType, MessageKey[]>> = {
  COMMERCIAL_INVOICE: ['extracted.columns.description', 'extracted.columns.quantity', 'extracted.columns.unitPrice', 'extracted.columns.total', 'extracted.columns.origin'],
  PACKING_LIST: ['extracted.columns.packages', 'extracted.columns.description', 'extracted.columns.quantity', 'extracted.columns.grossKg'],
  BILL_OF_LADING: ['extracted.columns.seal', 'extracted.columns.type', 'extracted.columns.packages', 'extracted.columns.grossKg'],
};
