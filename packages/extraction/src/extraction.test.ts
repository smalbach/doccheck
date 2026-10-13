import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDocument } from './classify';
import { countryCode, countryFromPostalCode, decimal, htsCode, isoDate, localeFor, normalizeBillOfLading, normalizeIsf, normalizePackingList, quantityUnit, weight, withLocale } from './normalize';
import { readPdfText } from './pdf-text';
import { findFieldSource, findSource } from './provenance';
import type { RawBillOfLading, RawIsf, RawParty } from './raw-schemas';
import { scoreDocument, tally } from './score';

describe('normalization', () => {
  it('parses printed amounts', () => {
    expect(decimal('48,600.00')).toBe('48600.00');
    expect(decimal('USD 1,234.5')).toBe('1234.5');
    expect(decimal('1.234,56')).toBe('1234.56');
    expect(decimal('12,5')).toBe('12.5');
    expect(decimal('1,234')).toBe('1234');
    expect(decimal('320 M2')).toBe('320');
    expect(decimal('48 600,00')).toBe('48600.00');
    expect(decimal('1\u00a0140,50 kg')).toBe('1140.50');
    expect(decimal('2 514 lb')).toBe('2514');
    expect(decimal('12 40')).toBe('12');
    expect(decimal('(12.50)')).toBe('-12.50');
    expect(decimal('n/a')).toBeNull();
  });

  it('parses the date formats the templates print', () => {
    expect(isoDate('2026-03-14')).toBe('2026-03-14');
    expect(isoDate('14-MAR-2026')).toBe('2026-03-14');
    expect(isoDate('Mar 14, 2026')).toBe('2026-03-14');
    expect(isoDate('14/03/2026')).toBe('2026-03-14');
    expect(isoDate('14.03.2026')).toBe('2026-03-14');
    expect(isoDate('4 March 2026')).toBe('2026-03-04');
  });

  it('settles ambiguous numbers and dates with the issuer country', () => {
    const de = localeFor('Germany');
    const us = localeFor('US');
    expect([decimal('1.200'), withLocale(de, () => decimal('1.200')), withLocale(us, () => decimal('1.200'))]).toEqual(['1.200', '1200', '1.200']);
    // Unambiguous forms read the same everywhere.
    expect(withLocale(de, () => [decimal('1,140.50'), decimal('1.140,50'), decimal('12.5'), decimal('1.2345')])).toEqual(['1140.50', '1140.50', '12.5', '1.2345']);
    expect([isoDate('03/04/2026'), withLocale(us, () => isoDate('03/04/2026')), withLocale(us, () => isoDate('14/03/2026')), withLocale(de, () => isoDate('03/04/2026'))]).toEqual(['2026-04-03', '2026-03-04', '2026-03-14', '2026-04-03']);
    expect(decimal('1.200')).toBe('1.200');
    expect(isoDate('soon')).toBeNull();
  });

  it('converts pounds to kilograms and keeps the printed value', () => {
    expect(weight({ value: '2,205', unit: 'LBS' })).toEqual({ kg: '1000.17', raw: { value: '2205', unit: 'LB' } });
    expect(weight({ value: '1,140.00 KGS', unit: null })).toEqual({ kg: '1140.00', raw: { value: '1140.00', unit: 'KG' } });
  });

  it('maps countries and units', () => {
    expect(countryCode('Viet Nam')).toBe('VN');
    expect(countryCode('cn')).toBe('CN');
    expect(quantityUnit('pieces')).toBe('PCS');
    expect(quantityUnit('M²')).toBe('M2');
  });

  it('drops an unreadable optional field but keeps the document', () => {
    const party = { name: 'X Co', addressLines: ['1 Main St'], city: null, region: null, postalCode: null, country: 'CN', taxId: null };
    const raw: RawBillOfLading = {
      blNumber: 'B1', documentTitle: 'BILL OF LADING', issuer: null, bookingNumber: null, carrierName: null, scac: null,
      shipper: party, consignee: { ...party, country: 'Canada' }, notifyParty: null, vessel: null, voyage: null, placeOfReceipt: null,
      portOfLoading: { name: 'Ningbo', country: 'CN' }, portOfDischarge: { name: 'Vancouver', country: 'CA' }, placeOfDelivery: null,
      containers: [{ number: 'not a container', seal: null, type: null, packages: '10', grossWeight: null, volumeM3: null }],
      totalPackages: '10', totalGrossWeight: { value: '500', unit: 'KG' }, marksAndNumbers: null, cargoDescription: 'TOYS',
      freightTerms: 'FREIGHT COLLECT', references: [], placeOfIssue: null, dateOfIssue: null, shippedOnBoardDate: null,
    };
    const { data, issues } = normalizeBillOfLading(raw);
    expect(data?.containers).toEqual([]);
    expect(data?.consignee.address.country).toBe('CA');
    expect(data?.freightTerms).toBe('COLLECT');
    expect(issues[0]).toMatch(/containers\[0\]/);
  });

  it('keeps a party whose country is unreadable, and infers it from a CA or US postal code', () => {
    expect([countryFromPostalCode('H7S 1P6'), countryFromPostalCode('77041', 'TX'), countryFromPostalCode('518112', 'Guangdong'), countryFromPostalCode('20457')]).toEqual(['CA', 'US', null, null]);
    const party = { name: 'X Co', addressLines: ['1 Main St'], city: null, region: null, postalCode: null, country: '', taxId: null };
    const raw: RawBillOfLading = {
      blNumber: 'B1', documentTitle: 'BILL OF LADING', issuer: null, bookingNumber: null, carrierName: null, scac: null,
      shipper: party, consignee: { ...party, region: 'QC', postalCode: 'H7S 1P6' }, notifyParty: null, vessel: null, voyage: null, placeOfReceipt: null,
      portOfLoading: { name: 'Ningbo', country: 'CN' }, portOfDischarge: { name: 'Vancouver', country: 'CA' }, placeOfDelivery: null,
      containers: [], totalPackages: '10', totalGrossWeight: { value: '500', unit: 'KG' }, marksAndNumbers: null, cargoDescription: 'TOYS',
      freightTerms: null, references: [], placeOfIssue: null, dateOfIssue: null, shippedOnBoardDate: null,
    };
    const { data } = normalizeBillOfLading(raw);
    expect([data?.shipper.name, data?.shipper.address.country, data?.consignee.address.country]).toEqual(['X Co', undefined, 'CA']);
  });

  it('returns what it could read when the document fails validation', () => {
    const party = { name: 'X Co', addressLines: ['1 Main St'], city: null, region: null, postalCode: null, country: 'CN', taxId: null };
    const raw: RawBillOfLading = {
      blNumber: 'B1', documentTitle: 'BILL OF LADING', issuer: null, bookingNumber: null, carrierName: null, scac: null,
      shipper: party, consignee: party, notifyParty: null, vessel: 'MERIDIAN STAR', voyage: null, placeOfReceipt: null,
      portOfLoading: { name: 'Ningbo', country: 'CN' }, portOfDischarge: { name: 'Vancouver', country: 'CA' }, placeOfDelivery: null,
      containers: [], totalPackages: '10', totalGrossWeight: { value: 'illegible', unit: null }, marksAndNumbers: null, cargoDescription: 'TOYS',
      freightTerms: null, references: [], placeOfIssue: null, dateOfIssue: null, shippedOnBoardDate: null,
    };
    const { data, partial, issues } = normalizeBillOfLading(raw);
    expect(data).toBeNull();
    expect(issues.some((i) => i.startsWith('totalGrossWeight'))).toBe(true);
    expect(partial).toMatchObject({ blNumber: 'B1', vessel: 'MERIDIAN STAR', totalPackages: 10 });
  });
});

describe('classification', () => {
  it('survives an OCR-mangled title', () => {
    expect(classifyDocument('   MMERCIAL      I    ICE\nINV NO: CI/26/0887\nTERMS: CIF MONTREAL\nCURRENCY: CAD\nITEM  DESCRIPTION  QTY  U/P CAD  AMT CAD\nN.W.: 870 KGS  G.W.: 1140 KGS').type).toBe('COMMERCIAL_INVOICE');
  });

  it('does not take an invoice reference on a packing list for a title', () => {
    expect(classifyDocument('Packing List\nAcme Co.   Invoice No. CI/26/0799\nMarks: 1-279\nCarton No.  Packages  Description  Net Weight  Gross Weight  Dimensions (cm)').type).toBe('PACKING_LIST');
  });
});

describe('ISF', () => {
  const p = (name: string | null, country = 'CN', extra: Partial<RawParty> = {}): RawParty => ({ name, addressLines: ['No. 18 Longgang Industrial Ave', 'Buji Subdistrict'], city: 'Shenzhen', region: 'Guangdong', postalCode: '518112', country, taxId: null, ...extra });
  const raw: RawIsf = {
    importerOfRecordNumber: '74-381245600',
    consigneeNumber: '74-381245600 ',
    manufacturer: p('Brightstar Toys Manufacturing Co., Ltd.'),
    seller: p('Brightstar Toys Manufacturing Co., Ltd.'),
    buyer: p('Bluebonnet Home Goods LLC', 'US', { addressLines: ['4200 Ambassador Caffery Pkwy'], city: 'Houston', region: 'TX', postalCode: '77041', taxId: '74-3812456' }),
    shipToParty: p('Bluebonnet Home Goods DC', 'United States', { addressLines: ['9800 Wallisville Rd'], city: 'Houston', region: 'TX', postalCode: '77013' }),
    containerStuffingLocation: p(null),
    consolidator: p('Silverline Logistics (HK) Ltd.', 'Hong Kong', { addressLines: ['25 Harbour Rd'], city: 'Wan Chai', region: null, postalCode: null }),
    countryOfOrigin: 'China',
    htsCode: '9503.00',
  };

  it('normalizes the printed filing to the Isf schema', () => {
    const { data, issues } = normalizeIsf(raw);
    expect(issues).toEqual([]);
    expect(data).toMatchObject({
      importerOfRecordNumber: '74-381245600',
      consigneeNumber: '74-381245600',
      countryOfOrigin: 'CN',
      htsCode: '950300',
      shipToParty: { name: 'Bluebonnet Home Goods DC', address: { country: 'US', postalCode: '77013' } },
      consolidator: { address: { country: 'HK' } },
      containerStuffingLocation: { lines: ['No. 18 Longgang Industrial Ave', 'Buji Subdistrict'], city: 'Shenzhen', country: 'CN' },
      buyer: { taxId: '74-3812456' },
    });
  });

  it('finds an HTS number printed with dots only for HTS fields', () => {
    const pdf = { pageCount: 1, text: '', lines: [{ page: 1, text: '10   Commodity HTSUS number (6-digit)   9403.60', bbox: [0, 0, 1, 1] as [number, number, number, number] }] };
    expect(findFieldSource(pdf, 'isf', 'htsCode', '940360')?.page).toBe(1);
    expect(findFieldSource(pdf, 'inv', 'lines[0].hsCode', '9403601020')).toBeUndefined();
    expect(findFieldSource(pdf, 'inv', 'invoiceTotal.amount', '940360')).toBeUndefined();
  });

  it('reads HTS numbers as printed', () => {
    expect(htsCode('9503.00')).toBe('950300');
    expect(htsCode('HTS 8481.80.1020')).toBe('8481801020');
    expect(htsCode('8481')).toBeNull();
    expect(htsCode(null)).toBeNull();
  });

  it('returns no document when a required element is missing or unreadable', () => {
    const { data, issues } = normalizeIsf({ ...raw, seller: null, htsCode: 'see invoice', importerOfRecordNumber: 'N/A' });
    expect(data).toBeNull();
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/^htsCode: could not normalize/), expect.stringMatching(/^importerOfRecordNumber:/), expect.stringMatching(/^seller:/)]));
  });

  it('classifies a filing confirmation as ISF', () => {
    const text = 'ISF FILING CONFIRMATION\nImporter Security Filing (10+2) · 19 CFR Part 149\nIMPORTER OF RECORD NO.   CONSIGNEE NO.\n1  Manufacturer (or supplier)  Acme\n2  Seller  Acme\n3  Buyer  Bluebonnet\n4  Ship-to party  Bluebonnet DC\n5  Container stuffing location  Shenzhen\n6  Consolidator (stuffer)  Silverline\n10  Commodity HTSUS number  9503.00';
    expect(classifyDocument(text)).toMatchObject({ type: 'ISF' });
    // OCR may lose the title; the element names still decide.
    expect(classifyDocument(text.split('\n').slice(2).join('\n')).type).toBe('ISF');
  });

  it('does not take an invoice that names a buyer, seller or manufacturer for an ISF', () => {
    expect(classifyDocument('COMMERCIAL INVOICE\nSeller: Acme  Manufacturer: Acme Factory\nSOLD TO: Bluebonnet\nCurrency: USD\nUnit Price  Amount').type).toBe('COMMERCIAL_INVOICE');
  });
});

describe('OCR debris', () => {
  it('treats a reference without digits as unreadable instead of comparing it', () => {
    const pkg = { range: '1-10', count: '10', packageType: 'CTN', sku: null, description: 'Toys', quantity: '100', unit: 'PCS', netWeight: null, grossWeight: null, dimensionsCm: null };
    const { data, issues } = normalizePackingList({ packingListNumber: 'PL-1', invoiceRef: 'rr,,', seller: null, consignee: null, marks: null, packages: [pkg], totalPackages: '10', totalNetWeight: null, totalGrossWeight: null, totalVolumeM3: null });
    expect(data?.invoiceRef).toBeUndefined();
    expect(issues[0]).toMatch(/does not look like a document number/);
  });
});

describe('scoring', () => {
  it('counts wrong, missing and spurious fields', () => {
    const truth = { blNumber: 'B1', totalPackages: 10, containers: [{ number: 'A' }, { number: 'B' }] };
    const got = { blNumber: 'b1', totalPackages: 11, containers: [{ number: 'A' }], vessel: 'X' };
    const t = tally(scoreDocument('BILL_OF_LADING', truth, got));
    expect(t).toMatchObject({ correct: 2, wrong: 1, missing: 1, spurious: 1 });
  });
});

// Needs the generated evaluation set (npm run synth); skipped on a fresh checkout.
const sample = join(__dirname, '../../../data/eval/v1/CA-001');
describe.skipIf(!existsSync(join(sample, 'invoice.pdf')))('PDF text layer', () => {
  it('reads, classifies and locates values in every document of a shipment', async () => {
    const truth = JSON.parse(await readFile(join(sample, 'truth.json'), 'utf8'));
    const expected = { 'invoice.pdf': 'COMMERCIAL_INVOICE', 'packing-list.pdf': 'PACKING_LIST', 'bill-of-lading.pdf': 'BILL_OF_LADING' };
    for (const [file, type] of Object.entries(expected)) {
      const pdf = await readPdfText(await readFile(join(sample, file)));
      expect(pdf.pageCount).toBeGreaterThan(0);
      expect(classifyDocument(pdf.text).type).toBe(type);
    }
    const bl = await readPdfText(await readFile(join(sample, 'bill-of-lading.pdf')));
    const source = findSource(bl, 'bl', String(truth.documents.billOfLading.totalPackages));
    expect(source?.page).toBe(1);
    expect(source?.bbox).toHaveLength(4);
  });

  it('matches a number after a longer number that contains it', () => {
    const pdf = { pageCount: 1, text: '', lines: [{ page: 1, text: 'PUMP 0.75 KW   5 PCS   83.65', bbox: [0, 0, 1, 1] as [number, number, number, number] }] };
    expect(findSource(pdf, 'inv', '5')?.rawText).toContain('5 PCS');
  });

  it('matches European number formats', () => {
    const line = (text: string) => ({ page: 1, text, bbox: [0, 0, 1, 1] as [number, number, number, number] });
    const pdf = { pageCount: 1, text: '', lines: [line('Net weight 1 011,84 kg'), line('Invoice total EUR 48.600,00'), line('Quantity 1 200 PRS')] };
    expect(findSource(pdf, 'inv', '1011.84')?.rawText).toContain('kg');
    expect(findSource(pdf, 'inv', '48600.00')?.rawText).toContain('EUR');
    expect(findSource(pdf, 'inv', '1200')?.rawText).toContain('PRS');
    expect(findSource(pdf, 'inv', '600')).toBeUndefined();
  });
});

// Needs the ISF set (npm run synth -- --isf-pdfs); skipped otherwise.
const isfSample = join(__dirname, '../../../data/eval/v1-isf/US-002');
describe.skipIf(!existsSync(join(isfSample, 'isf.pdf')))('ISF PDF', () => {
  it('reads and classifies the filing confirmation and locates its values', async () => {
    const truth = JSON.parse(await readFile(join(isfSample, 'truth.json'), 'utf8'));
    const pdf = await readPdfText(await readFile(join(isfSample, 'isf.pdf')));
    expect(classifyDocument(pdf.text).type).toBe('ISF');
    expect(findSource(pdf, 'isf', truth.documents.isf.importerOfRecordNumber)?.page).toBe(1);
    expect(findSource(pdf, 'isf', truth.documents.isf.consolidator.name)?.bbox).toHaveLength(4);
  });
});

// Needs the scanned set (npm run synth -- --scans 40); skipped otherwise.
const scan = join(__dirname, '../../../data/eval/v1-scans/CA-001/bill-of-lading.pdf');
describe.skipIf(!existsSync(scan))('OCR', () => {
  it('reads a scanned PDF with no text layer into positioned lines', async () => {
    const { terminateOcr } = await import('./ocr');
    const truth = JSON.parse(await readFile(join(scan, '../truth.json'), 'utf8'));
    const pdf = await readPdfText(await readFile(scan));
    await terminateOcr();
    expect(pdf.ocrPages).toEqual([1]);
    expect(pdf.text).toContain(truth.documents.billOfLading.blNumber);
    expect(classifyDocument(pdf.text).type).toBe('BILL_OF_LADING');
    expect(findSource(pdf, 'bl', truth.documents.billOfLading.blNumber)?.bbox).toHaveLength(4);
  }, 60_000);
});
