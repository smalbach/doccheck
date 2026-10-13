import type { DocumentType } from '../api/types';

export interface FieldSpec {
  label: string;
  /** Dot path into the normalized document. */
  path: string;
}

/** Key fields shown per document type. */
export const EXTRACTED_FIELDS: Partial<Record<DocumentType, FieldSpec[]>> = {
  COMMERCIAL_INVOICE: [
    { label: 'Invoice no.', path: 'invoiceNumber' },
    { label: 'Invoice date', path: 'invoiceDate' },
    { label: 'PO', path: 'poNumber' },
    { label: 'Seller', path: 'seller.name' },
    { label: 'Buyer', path: 'buyer.name' },
    { label: 'Consignee', path: 'consignee.name' },
    { label: 'Shipment date', path: 'shipmentDate' },
    { label: 'Terms of sale', path: 'incoterm.code' },
    { label: 'Currency', path: 'currency' },
    { label: 'Packages', path: 'packageCount' },
    { label: 'Net weight (kg)', path: 'netWeight.kg' },
    { label: 'Gross weight (kg)', path: 'grossWeight.kg' },
    { label: 'Invoice total', path: 'invoiceTotal.amount' },
    { label: 'Port of entry', path: 'portOfEntry.name' },
  ],
  PACKING_LIST: [
    { label: 'Packing list no.', path: 'packingListNumber' },
    { label: 'Invoice ref.', path: 'invoiceRef' },
    { label: 'Consignee', path: 'consignee.name' },
    { label: 'Packages', path: 'totals.packageCount' },
    { label: 'Net weight (kg)', path: 'totals.netWeight.kg' },
    { label: 'Gross weight (kg)', path: 'totals.grossWeight.kg' },
    { label: 'Volume (m³)', path: 'totals.volumeM3' },
  ],
  BILL_OF_LADING: [
    { label: 'B/L no.', path: 'blNumber' },
    { label: 'Carrier', path: 'carrier.name' },
    { label: 'Shipper', path: 'shipper.name' },
    { label: 'Consignee', path: 'consignee.name' },
    { label: 'Vessel / voyage', path: 'vessel' },
    { label: 'Port of loading', path: 'portOfLoading.name' },
    { label: 'Port of discharge', path: 'portOfDischarge.name' },
    { label: 'On board', path: 'shippedOnBoardDate' },
    { label: 'Packages', path: 'totalPackages' },
    { label: 'Gross weight (kg)', path: 'totalGrossWeight.kg' },
    { label: 'Freight', path: 'freightTerms' },
  ],
  ISF: [
    { label: 'Importer of record no.', path: 'importerOfRecordNumber' },
    { label: 'Consignee no.', path: 'consigneeNumber' },
    { label: 'Seller', path: 'seller.name' },
    { label: 'Buyer', path: 'buyer.name' },
    { label: 'Manufacturer', path: 'manufacturer.name' },
    { label: 'Ship-to party', path: 'shipToParty.name' },
    { label: 'Country of origin', path: 'countryOfOrigin' },
    { label: 'HTS', path: 'htsCode' },
    { label: 'Stuffing location', path: 'containerStuffingLocation.city' },
    { label: 'Consolidator', path: 'consolidator.name' },
  ],
};

/** Column headings of the line table per document type (the first column is the row label). */
export const EXTRACTED_ROW_HEADINGS: Partial<Record<DocumentType, string[]>> = {
  COMMERCIAL_INVOICE: ['Description', 'Quantity', 'Unit price', 'Total', 'Origin'],
  PACKING_LIST: ['Packages', 'Description', 'Quantity', 'Gross kg'],
  BILL_OF_LADING: ['Seal', 'Type', 'Packages', 'Gross kg'],
};
