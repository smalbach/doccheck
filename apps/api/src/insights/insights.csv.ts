import type { CsvColumn } from '../common/csv';
import type { GoodsLine, ShipmentData } from './insights.types';

/** Most rows a CSV export holds; more matching rows are left out. */
export const CSV_MAX_ROWS = 50_000;

/** One column per field of an invoice line; amounts as decimal strings, their currency apart. */
export const GOODS_CSV_COLUMNS: readonly CsvColumn<GoodsLine>[] = [
  { header: 'Shipment reference', value: (l) => l.reference },
  { header: 'Shipment ID', value: (l) => l.shipmentId },
  { header: 'Destination', value: (l) => l.destination },
  { header: 'Invoice number', value: (l) => l.invoiceNumber },
  { header: 'Seller', value: (l) => l.seller },
  { header: 'Line no', value: (l) => l.lineNo || undefined },
  { header: 'SKU', value: (l) => l.sku },
  { header: 'Description', value: (l) => l.description },
  { header: 'HS code', value: (l) => l.hsCode },
  { header: 'Country of origin', value: (l) => l.countryOfOrigin },
  { header: 'Quantity', value: (l) => l.quantity?.value },
  { header: 'Unit', value: (l) => l.quantity?.unit },
  { header: 'Unit price', value: (l) => l.unitPrice?.amount },
  { header: 'Currency', value: (l) => l.lineTotal?.currency ?? l.unitPrice?.currency },
  { header: 'Line total', value: (l) => l.lineTotal?.amount },
];

/** One column per key figure of a shipment; containers joined with "; ". */
export const SHIPMENTS_CSV_COLUMNS: readonly CsvColumn<ShipmentData>[] = [
  { header: 'Shipment reference', value: (s) => s.reference },
  { header: 'Shipment ID', value: (s) => s.shipmentId },
  { header: 'Destination', value: (s) => s.destination },
  { header: 'Invoice number', value: (s) => s.invoiceNumber },
  { header: 'Invoice date', value: (s) => s.invoiceDate },
  { header: 'Seller', value: (s) => s.seller },
  { header: 'Buyer', value: (s) => s.buyer },
  { header: 'Incoterm', value: (s) => s.incoterm },
  { header: 'Invoice total', value: (s) => s.invoiceTotal?.amount },
  { header: 'Currency', value: (s) => s.invoiceTotal?.currency },
  { header: 'Lines', value: (s) => s.lines },
  { header: 'Packages', value: (s) => s.packages },
  { header: 'Gross kg', value: (s) => s.grossKg },
  { header: 'Net kg', value: (s) => s.netKg },
  { header: 'Volume m3', value: (s) => s.volumeM3 },
  { header: 'B/L number', value: (s) => s.blNumber },
  { header: 'Carrier', value: (s) => s.carrier },
  { header: 'Vessel', value: (s) => s.vessel },
  { header: 'Port of loading', value: (s) => s.portOfLoading },
  { header: 'Port of discharge', value: (s) => s.portOfDischarge },
  { header: 'Containers', value: (s) => s.containers.join('; ') },
];
