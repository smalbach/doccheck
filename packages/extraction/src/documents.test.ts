import { describe, expect, it } from 'vitest';
import { classifyDocument } from './classify';
import { airport, awbNumber, freightTerms, hazardClass, ispmMark, normalizeAirWaybill, normalizeCusmaCertification, normalizeDangerousGoods, normalizeWoodPackaging, packingGroup, unNumber } from './normalize-documents';
import { dropUnprintedValues } from './printed-documents';
import type { PdfText } from './pdf-text';
import type { RawParty } from './raw-schemas';
import type { RawAirWaybill, RawCusmaCertification, RawDangerousGoods } from './raw-schemas-documents';
import { scoreDocument } from './score';

const party = (name: string, country = 'CN'): RawParty => ({ name, addressLines: ['88 Industrial Rd'], city: 'Shenzhen', region: null, postalCode: null, country, taxId: null });
const lines = (...texts: string[]): PdfText => ({ pageCount: 1, lines: texts.map((text, i) => ({ page: 1, text, bbox: [40, 40 + i * 12, 500, 50 + i * 12] })), text: texts.join('\n') });

describe('normalizing the other documents', () => {
  it('reads air waybill numbers, airports and charges codes', () => {
    expect(awbNumber('176-1234 5675')).toBe('176-12345675');
    expect(awbNumber('MAWB No.: 17612345675')).toBe('176-12345675');
    expect(awbNumber('SZX F0012345')).toBe('SZXF0012345');
    expect(airport({ name: 'Shanghai Pudong (PVG)', code: null })).toEqual({ name: 'Shanghai Pudong', iata: 'PVG' });
    expect(airport({ name: 'YYZ', code: null })).toEqual({ name: 'YYZ', iata: 'YYZ' });
    expect(airport({ name: 'Toronto', code: 'yyz' })).toEqual({ name: 'Toronto', iata: 'YYZ' });
    expect([freightTerms('PP'), freightTerms('WT/VAL CC'), freightTerms('Freight Prepaid'), freightTerms('n/a')]).toEqual(['PREPAID', 'COLLECT', 'PREPAID', undefined]);
  });

  it('normalizes a house air waybill', () => {
    const raw: RawAirWaybill = {
      awbNumber: 'SZXF0012345', documentTitle: 'HOUSE AIR WAYBILL', masterAwbNumber: '176-1234 5675', carrierName: 'Example Air Cargo',
      shipper: party('Acme Toys Co., Ltd.'), consignee: party('Maple Retail Inc.', 'Canada'), notifyParty: null,
      airportOfDeparture: { name: 'Shenzhen', code: 'SZX' }, airportOfDestination: { name: 'Toronto (YYZ)', code: null },
      routing: ['SZX', 'YVR', 'yyz'], flights: [{ flight: 'xa821', date: '06-OCT-2026' }], numberOfPieces: '120', grossWeight: { value: '1,250.0', unit: 'K' },
      chargeableWeight: { value: '1920', unit: 'KG' }, volume: '11.52 M3', natureOfGoods: 'PLUSH TOYS', freightTerms: 'CC', handlingInformation: null,
      references: ['INV-2026-0412'], placeOfExecution: 'Shenzhen', executedOn: '05-OCT-2026',
    };
    const { data, issues } = normalizeAirWaybill(raw);
    expect(issues).toEqual([]);
    expect(data).toMatchObject({
      awbNumber: 'SZXF0012345', issuer: 'HAWB', masterAwbNumber: '176-12345675', airportOfDestination: { name: 'Toronto', iata: 'YYZ' },
      routing: ['SZX', 'YVR', 'YYZ'], flights: [{ flight: 'XA821', date: '2026-10-06' }], pieces: 120, chargeableWeight: { kg: '1920.00' }, freightTerms: 'COLLECT', volumeM3: '11.52',
    });
  });

  it('reads UN numbers, classes, packing groups and ISPM marks', () => {
    expect([unNumber('UN 3480'), unNumber('3480'), unNumber('UN34')]).toEqual(['UN3480', 'UN3480', null]);
    expect([hazardClass('Class 9'), hazardClass('2.1'), hazardClass('Div. 5.1')]).toEqual(['9', '2.1', '5.1']);
    expect([packingGroup('PG II'), packingGroup('3'), packingGroup('Packing group III'), packingGroup('IV')]).toEqual(['II', 'III', 'III', null]);
    expect(ispmMark('CN-3301 HT')).toEqual({ country: 'CN', registration: '3301', treatment: 'HT' });
    expect(ispmMark('IPPC VN 0123-MB')).toEqual({ country: 'VN', registration: '0123', treatment: 'MB' });
  });

  it('turns "Various" into the producer statement of a CUSMA certification', () => {
    const raw: RawCusmaCertification = {
      certifierRole: 'Exporter', certifier: party('Norte Steel SA de CV', 'MX'), exporter: null, producer: { ...party('VARIOUS', 'MX'), addressLines: [] }, importer: party('Maple Retail Inc.', 'CA'),
      goods: [{ description: 'Steel brackets', hsCode: '732690', originCriterion: '(B)', countryOfOrigin: 'Mexico' }],
      blanketFrom: '01/01/2026', blanketTo: '31/12/2026', signatoryName: 'Ana Ruiz', signatoryTitle: 'Export manager', signatureDate: '03/10/2026', invoiceRefs: [],
    };
    const { data } = normalizeCusmaCertification(raw);
    expect(data).toMatchObject({ certifierRole: 'EXPORTER', producerStatement: 'VARIOUS', goods: [{ hsCode: '7326.90', originCriterion: 'B', countryOfOrigin: 'MX' }], blanketPeriod: { from: '2026-01-01', to: '2026-12-31' } });
    expect(data?.producer).toBeUndefined();
  });

  it('tells the kind of a wood packaging certificate from its title', () => {
    const base = { certificateNumber: 'X', statement: null, treatment: null, ispmMark: null, treatmentDate: null, issuer: null, exporter: null, consignee: null, packagingDescription: null, containers: [], transportDocumentNumber: null, invoiceRef: null, dateOfIssue: null };
    expect(normalizeWoodPackaging({ ...base, documentTitle: 'FUMIGATION CERTIFICATE', treatment: 'Methyl bromide' }).data).toMatchObject({ kind: 'FUMIGATION', treatment: 'MB' });
    expect(normalizeWoodPackaging({ ...base, documentTitle: 'PACKING DECLARATION', statement: 'This shipment does not contain any wood packaging material' }).data).toMatchObject({ kind: 'NO_WOOD_DECLARATION' });
  });
});

describe('values a model fills in on the other documents', () => {
  const dg: RawDangerousGoods = {
    shipper: party('Acme Toys Co., Ltd.'), consignee: null, transportDocumentNumber: null, mode: null, regulation: 'IMDG',
    items: [{ unNumber: 'UN 3481', properShippingName: 'Lithium ion batteries packed with equipment', hazardClass: '9', subsidiaryRisk: null, packingGroup: 'II', quantity: '6000', unit: 'PCS', packages: null }],
    emergencyContact: null, signatoryName: null, signatoryPlace: null, signatureDate: null,
  };

  it('drops a packing group the declaration does not print', () => {
    const data = normalizeDangerousGoods(dg).data!;
    const pdf = lines('DANGEROUS GOODS DECLARATION', 'UN No.    Proper shipping name                          Class', 'UN 3481   LITHIUM ION BATTERIES PACKED WITH EQUIPMENT   9');
    expect(dropUnprintedValues('DANGEROUS_GOODS_DECLARATION', data, dg, pdf)).toEqual(['items[0].packingGroup: "II" is not printed under a packing group label; dropped']);
    expect(data.items[0].packingGroup).toBeUndefined();
    const kept = normalizeDangerousGoods(dg).data!;
    expect(dropUnprintedValues('DANGEROUS_GOODS_DECLARATION', kept, dg, lines('UN No.   Class   Packing group', 'UN 3481  9       II'))).toEqual([]);
  });

  it('drops a CUSMA origin criterion and certifier role nobody ticked', () => {
    const raw: RawCusmaCertification = {
      certifierRole: 'Exporter', certifier: null, exporter: null, producer: null, importer: null,
      goods: [{ description: 'Steel brackets', hsCode: '7326.90', originCriterion: 'B', countryOfOrigin: null }],
      blanketFrom: null, blanketTo: null, signatoryName: null, signatoryTitle: null, signatureDate: null, invoiceRefs: [],
    };
    const data = normalizeCusmaCertification(raw).data!;
    const pdf = lines('CUSMA CERTIFICATION OF ORIGIN', '1. Certifier:  [ ] Importer  [ ] Exporter  [ ] Producer', 'Description      HS tariff    Origin criterion', 'Steel brackets   7326.90');
    expect(dropUnprintedValues('CUSMA_CERTIFICATION', data, raw, pdf)).toHaveLength(2);
    expect(data.certifierRole).toBeUndefined();
    expect(data.goods[0].originCriterion).toBeUndefined();
    const ticked = normalizeCusmaCertification(raw).data!;
    expect(dropUnprintedValues('CUSMA_CERTIFICATION', ticked, raw, lines('1. Certifier:  [ ] Importer  [X] Exporter', 'Description      HS tariff    Origin criterion', 'Steel brackets   7326.90      B'))).toEqual([]);
  });
});

describe('classifying the other documents', () => {
  it.each([
    ['AIR_WAYBILL', 'AIR WAYBILL\nNot negotiable\nShipper\nAirport of departure SHENZHEN\nAirport of destination TORONTO\nNo. of pieces  Gross weight  Rate class  Chargeable weight\nNature and quantity of goods'],
    ['CUSMA_CERTIFICATION', 'CUSMA / USMCA CERTIFICATION OF ORIGIN\n1. Certifier\n3. Exporter\n4. Producer\n5. Importer\nOrigin criterion\nBlanket period'],
    ['CERTIFICATE_OF_ORIGIN', 'CERTIFICATE OF ORIGIN\nIssued by the Chamber of Commerce\nCountry of origin: CHINA\nWe hereby certify that the goods described below originate in China'],
    ['ARRIVAL_NOTICE', 'ARRIVAL NOTICE\nB/L No. HBLSZ123456\nVessel MERIDIAN STAR\nPort of loading YANTIAN\nETA 2026-10-24\nLast free day 2026-10-29\nContainer No  Seal No\nAmount due USD 450.00'],
    ['WOOD_PACKAGING_CERTIFICATE', 'HEAT TREATMENT CERTIFICATE\nISPM 15\nWood packaging material treated at 56 °C core temperature for 30 minutes\nIPPC mark CN-3301 HT'],
    ['DANGEROUS_GOODS_DECLARATION', "SHIPPER'S DECLARATION FOR DANGEROUS GOODS\nAir waybill No. 176-12345675\nAirport of departure SZX\nUN or ID No.  Proper shipping name  Class or division  Packing group\nUN3481  LITHIUM ION BATTERIES PACKED WITH EQUIPMENT  9  II\nEmergency contact +86 755 0000 1111"],
  ])('%s', (type, text) => {
    expect(classifyDocument(text).type).toBe(type);
  });

  it('still reads a sea waybill as a bill of lading', () => {
    expect(classifyDocument('SEA WAYBILL\nPort of loading\nVessel\nContainer No').type).toBe('BILL_OF_LADING');
  });
});

describe('scoring the other documents', () => {
  it('scores air waybill fields', () => {
    const truth = { awbNumber: '176-12345675', pieces: 120, grossWeight: { kg: '1250' } };
    expect(scoreDocument('AIR_WAYBILL', truth, { ...truth, pieces: 118 }).map((s) => s.outcome)).toEqual(['correct', 'wrong', 'correct']);
  });
});
