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

/** A company of the user's documents, found again across shipments by its normalized name. */
export interface PartySummary {
  id: string;
  name: string;
  country?: string;
  taxId?: string;
  /** seller, buyer, consignee, shipper, notify, exporter, originator, manufacturer, ship_to, consolidator */
  roles: string[];
  /** How the documents spell it. */
  names: string[];
  shipments: number;
  /** Invoices where it is the seller or the buyer. */
  invoices: number;
  lines: number;
  values: Total[];
  products: number;
  firstDate?: string;
  lastDate?: string;
}

export interface PartyProduct {
  id: string;
  sku?: string;
  description: string;
  lines: number;
  quantities: Total[];
  values: Total[];
}

export interface PartyShipment {
  shipmentId: string;
  reference?: string;
  destination?: Destination;
  createdAt: string;
  roles: string[];
  invoiceNumber?: string;
  invoiceDate?: string;
  invoiceTotal?: { amount: string; currency: string };
}

/** An address, tax ID or contact the documents give for a company, with the roles it was given in. */
export interface PartyAddress {
  name: string;
  lines: string[];
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  taxId?: string;
  contact?: { name?: string; email?: string; phone?: string };
  roles: string[];
  documents: number;
}

/** Another company on the same documents: the buyer of a seller, the consignee of a shipper… */
export interface RelatedParty {
  id: string;
  name: string;
  country?: string;
  roles: string[];
  shipments: number;
}

export interface PartyDetail extends PartySummary {
  topProducts: PartyProduct[];
  recentShipments: PartyShipment[];
  addresses: PartyAddress[];
  related: RelatedParty[];
}

/** Unit price statistics in one currency. avg is weighted by quantity. */
export interface PriceStats {
  currency: string;
  min: string;
  max: string;
  avg: string;
  last: string;
}

/** A product bought on the user's invoices: by SKU, or by its normalized description. */
export interface ProductSummary {
  id: string;
  sku?: string;
  description: string;
  hsCode?: string;
  countryOfOrigin?: string;
  unit?: string;
  lines: number;
  shipments: number;
  sellers: number;
  lastSeller?: string;
  lastDate?: string;
  quantities: Total[];
  values: Total[];
  prices: PriceStats[];
}

/** One purchase of a product: an invoice line. */
export interface PricePoint {
  shipmentId: string;
  reference?: string;
  documentId: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  sellerId?: string;
  seller?: string;
  quantity?: { value: string; unit: string };
  unitPrice?: { amount: string; currency: string };
  lineTotal?: { amount: string; currency: string };
}

/** What one seller sold of a product, and at what price. */
export interface ProductSeller {
  id: string;
  name: string;
  country?: string;
  lines: number;
  quantities: Total[];
  prices: PriceStats[];
  lastDate?: string;
}

export interface ProductDetail extends ProductSummary {
  /** Oldest first. */
  history: PricePoint[];
  bySeller: ProductSeller[];
  /** How the invoices describe it, most used first. */
  descriptions: { text: string; lines: number }[];
  hsCodes: { code: string; lines: number }[];
  origins: { country: string; lines: number }[];
}

export interface ContainerRow {
  shipmentId: string;
  reference?: string;
  destination?: Destination;
  documentId: string;
  number: string;
  ownerCode?: string;
  sizeType?: string;
  seal?: string;
  packages?: number;
  grossKg?: string;
  volumeM3?: string;
  blNumber?: string;
  carrier?: string;
  scac?: string;
  vessel?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  shippedDate?: string;
}
