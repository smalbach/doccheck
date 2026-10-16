import type { AirWaybill, BillOfLading, CommercialInvoice, Destination, PackingList, TransportMode } from '@doccheck/schemas';

/** What an export is built from: the shipment and the extracted (normalized) documents the validation used. */
export interface ExportInput {
  shipment: { id: string; reference?: string | null; destination?: Destination | null; transportMode?: TransportMode | null };
  invoice?: CommercialInvoice;
  packingList?: PackingList;
  billOfLading?: BillOfLading;
  /** An air shipment carries an air waybill instead of a bill of lading. */
  airWaybill?: AirWaybill;
  /** When the export is made (ISO date-time); fixed in tests. */
  createdAt?: string;
}

export type ExportFormat = 'cargowise-xml' | 'x12-856' | 'x12-310';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['cargowise-xml', 'x12-856', 'x12-310'];

/** A built export file. */
export interface ExportFile {
  format: ExportFormat;
  fileName: string;
  contentType: string;
  body: string;
}

/** Thrown when the documents lack what a format needs (e.g. an 856 without a bill of lading). */
export class ExportInputError extends Error {}

/** A reference safe for a file name. */
export const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'shipment';
