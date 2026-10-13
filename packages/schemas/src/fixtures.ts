import type { BillOfLading } from './bill-of-lading';
import type { CommercialInvoice } from './commercial-invoice';
import type { PackingList } from './packing-list';

/**
 * A clean, consistent shipment (China -> Canada, sea) used in tests and demos.
 * Every cross-document rule should pass on it.
 */
const seller = {
  name: 'Acme Toys Co., Ltd.',
  address: { lines: ['88 Industrial Rd'], city: 'Shenzhen', country: 'CN' },
};
const buyer = {
  name: 'Maple Retail Inc.',
  address: { lines: ['100 King St W'], city: 'Toronto', region: 'ON', country: 'CA' },
};
const kg = (v: string) => ({ kg: v, raw: { value: v, unit: 'KG' } });

export const sampleInvoice: CommercialInvoice = {
  invoiceNumber: 'INV-2026-0412',
  invoiceDate: '2026-10-01',
  poNumber: 'PO-4411',
  seller,
  buyer,
  consignee: buyer,
  shipmentDate: '2026-10-05',
  transport: { mode: 'SEA', placeOfShipment: { name: 'Yantian', unLocode: 'CNYTN', country: 'CN' } },
  incoterm: { code: 'FOB', place: 'Shenzhen' },
  currency: 'USD',
  packageCount: 120,
  lines: [
    {
      lineNo: 1,
      sku: 'TB-200',
      description: 'Plush teddy bear 30 cm, polyester',
      quantity: { value: '6000', unit: 'PCS' },
      unitPrice: { amount: '8.10', currency: 'USD' },
      lineTotal: { amount: '48600.00', currency: 'USD' },
      countryOfOrigin: 'CN',
      hsCode: '9503.00',
    },
  ],
  grossWeight: kg('1250'),
  netWeight: kg('1100'),
  invoiceTotal: { amount: '48600.00', currency: 'USD' },
  language: 'en',
};

export const samplePackingList: PackingList = {
  packingListNumber: 'PL-2026-0412',
  invoiceRef: 'INV-2026-0412',
  seller,
  consignee: buyer,
  packages: [
    {
      range: '1-120',
      count: 120,
      type: 'CTN',
      marks: 'ACME/PO-4411',
      contents: [{ sku: 'TB-200', description: 'Plush teddy bear 30 cm', quantity: { value: '6000', unit: 'PCS' } }],
      netWeight: kg('1100'),
      grossWeight: kg('1250'),
      dimensionsCm: [60, 40, 40],
    },
  ],
  totals: { packageCount: 120, netWeight: kg('1100'), grossWeight: kg('1250'), volumeM3: '11.52' },
};

export const sampleBillOfLading: BillOfLading = {
  blNumber: 'HBLSZ123456',
  blType: { issuer: 'HBL', form: 'ORIGINAL' },
  carrier: { name: 'Example Line', scac: 'EXLN' },
  shipper: seller,
  consignee: buyer,
  portOfLoading: { name: 'Yantian', unLocode: 'CNYTN', country: 'CN' },
  portOfDischarge: { name: 'Vancouver', unLocode: 'CAVAN', country: 'CA' },
  placeOfDelivery: { name: 'Toronto', unLocode: 'CATOR', country: 'CA' },
  containers: [{ number: 'CSQU3054383', seal: 'ML-889120', type: '40HC', packages: 120, grossWeight: kg('1250') }],
  totalPackages: 120,
  totalGrossWeight: kg('1250'),
  cargoDescription: 'SAID TO CONTAIN 120 CTNS PLUSH TOYS',
  freightTerms: 'COLLECT',
  references: ['INV-2026-0412', 'PO-4411'],
};
