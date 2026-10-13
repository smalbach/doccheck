import type { Destination } from '@doccheck/schemas';

/** A sum per currency or unit; amounts are decimal strings, never floats. */
export interface Total {
  key: string;
  amount: string;
}

export interface InsightsSummary {
  /** Shipments with at least one extracted invoice, packing list or bill of lading. */
  shipments: number;
  invoiceLines: number;
  valueByCurrency: Total[];
  quantityByUnit: Total[];
  grossKg: string;
  netKg: string;
  packages: number;
  containers: number;
  byOrigin: { country: string | null; lines: number; values: Total[] }[];
  byHsCode: { hsCode: string | null; description: string; lines: number; values: Total[] }[];
}

export interface GoodsLine {
  shipmentId: string;
  reference?: string;
  destination?: Destination;
  documentId: string;
  invoiceNumber?: string;
  seller?: string;
  lineNo: number;
  sku?: string;
  description: string;
  hsCode?: string;
  countryOfOrigin?: string;
  quantity?: { value: string; unit: string };
  unitPrice?: { amount: string; currency: string };
  lineTotal?: { amount: string; currency: string };
}

export interface ShipmentData {
  shipmentId: string;
  reference?: string;
  destination?: Destination;
  createdAt: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  seller?: string;
  buyer?: string;
  incoterm?: string;
  invoiceTotal?: { amount: string; currency: string };
  lines: number;
  packages?: number;
  grossKg?: string;
  netKg?: string;
  volumeM3?: string;
  blNumber?: string;
  carrier?: string;
  vessel?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  containers: string[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
