import type { AirWaybill } from './air-waybill';
import type { ArrivalNotice } from './arrival-notice';
import type { CertificateOfOrigin, CusmaCertification } from './certificate-of-origin';
import type { DangerousGoodsDeclaration } from './dangerous-goods';
import { sampleBillOfLading, sampleInvoice } from './fixtures';
import type { WoodPackagingCertificate } from './wood-packaging';

/**
 * The other documents of the sample shipment (fixtures.ts), consistent with its invoice, packing
 * list and bill of lading. The air waybill is the same goods flown instead of shipped by sea.
 */
const kg = (v: string) => ({ kg: v, raw: { value: v, unit: 'KG' } });

export const sampleAirWaybill: AirWaybill = {
  awbNumber: '176-12345675',
  issuer: 'MAWB',
  carrier: { name: 'Example Air Cargo', iataPrefix: '176' },
  shipper: sampleInvoice.seller,
  consignee: sampleInvoice.buyer,
  airportOfDeparture: { name: 'Shenzhen Bao’an', iata: 'SZX' },
  airportOfDestination: { name: 'Toronto Pearson', iata: 'YYZ' },
  routing: ['SZX', 'YVR', 'YYZ'],
  flights: [{ flight: 'XA 821', date: '2026-10-06' }],
  pieces: 120,
  grossWeight: kg('1250'),
  chargeableWeight: kg('1920'),
  volumeM3: '11.52',
  natureOfGoods: 'PLUSH TOYS',
  freightTerms: 'COLLECT',
  references: ['INV-2026-0412'],
  executedOn: '2026-10-05',
};

export const sampleCertificateOfOrigin: CertificateOfOrigin = {
  certificateNumber: 'CCPIT-2026-118204',
  issuer: 'China Council for the Promotion of International Trade',
  exporter: sampleInvoice.seller,
  consignee: sampleInvoice.buyer,
  countryOfOrigin: 'CN',
  transport: 'By sea from Yantian to Vancouver',
  goods: [{ itemNo: 1, description: 'Plush teddy bear 30 cm, polyester', hsCode: '9503.00', quantity: { value: '6000', unit: 'PCS' } }],
  invoiceRefs: ['INV-2026-0412'],
  placeOfIssue: 'Shenzhen',
  dateOfIssue: '2026-10-03',
};

/** A CUSMA certification by the exporter, with all nine minimum data elements. */
export const sampleCusmaCertification: CusmaCertification = {
  certifierRole: 'EXPORTER',
  certifier: sampleInvoice.seller,
  exporter: sampleInvoice.seller,
  producer: sampleInvoice.seller,
  importer: sampleInvoice.buyer,
  goods: [{ description: 'Plush teddy bear 30 cm, polyester', hsCode: '9503.00', originCriterion: 'B' }],
  signature: { name: 'Li Wei', title: 'Export Manager', date: '2026-10-03' },
  invoiceRefs: ['INV-2026-0412'],
};

export const sampleArrivalNotice: ArrivalNotice = {
  noticeNumber: 'AN-77120',
  carrier: { name: 'Example Line', scac: 'EXLN' },
  mode: 'SEA',
  transportDocumentNumber: sampleBillOfLading.blNumber,
  portOfLoading: sampleBillOfLading.portOfLoading,
  portOfDischarge: sampleBillOfLading.portOfDischarge,
  estimatedArrival: '2026-10-24',
  consignee: sampleInvoice.buyer,
  containers: [{ number: 'CSQU3054383', seal: 'ML-889120', type: '40HC' }],
  packages: 120,
  grossWeight: kg('1250'),
  cargoDescription: 'PLUSH TOYS',
  freightTerms: 'COLLECT',
};

export const sampleWoodPackaging: WoodPackagingCertificate = {
  certificateNumber: 'HT-2026-55310',
  kind: 'HEAT_TREATMENT',
  treatment: 'HT',
  ispmMark: { country: 'CN', registration: '3301', treatment: 'HT' },
  treatmentDate: '2026-09-28',
  exporter: sampleInvoice.seller,
  packagingDescription: 'Wooden pallets',
  containers: ['CSQU3054383'],
  invoiceRef: 'INV-2026-0412',
};

export const sampleDangerousGoods: DangerousGoodsDeclaration = {
  shipper: sampleInvoice.seller,
  consignee: sampleInvoice.buyer,
  transportDocumentNumber: sampleBillOfLading.blNumber,
  mode: 'SEA',
  regulation: 'IMDG',
  items: [{ unNumber: 'UN3481', properShippingName: 'LITHIUM ION BATTERIES PACKED WITH EQUIPMENT', hazardClass: '9', packingGroup: 'II', quantity: { value: '6000', unit: 'PCS' } }],
  emergencyContact: '+86 755 0000 1111',
  signatory: { name: 'Li Wei', place: 'Shenzhen', date: '2026-10-03' },
};
