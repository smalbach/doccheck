import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyDocument } from './classify';
import { countryCode, decimal, isoDate, normalizeBillOfLading, normalizePackingList, quantityUnit, weight } from './normalize';
import { readPdfText } from './pdf-text';
import { findSource } from './provenance';
import type { RawBillOfLading } from './raw-schemas';
import { scoreDocument, tally } from './score';

describe('normalization', () => {
  it('parses printed amounts', () => {
    expect(decimal('48,600.00')).toBe('48600.00');
    expect(decimal('USD 1,234.5')).toBe('1234.5');
    expect(decimal('1.234,56')).toBe('1234.56');
    expect(decimal('12,5')).toBe('12.5');
    expect(decimal('1,234')).toBe('1234');
    expect(decimal('320 M2')).toBe('320');
    expect(decimal('(12.50)')).toBe('-12.50');
    expect(decimal('n/a')).toBeNull();
  });

  it('parses the date formats the templates print', () => {
    expect(isoDate('2026-03-14')).toBe('2026-03-14');
    expect(isoDate('14-MAR-2026')).toBe('2026-03-14');
    expect(isoDate('Mar 14, 2026')).toBe('2026-03-14');
    expect(isoDate('14/03/2026')).toBe('2026-03-14');
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
});

describe('classification', () => {
  it('survives an OCR-mangled title', () => {
    expect(classifyDocument('   MMERCIAL      I    ICE\nINV NO: CI/26/0887\nTERMS: CIF MONTREAL\nCURRENCY: CAD\nITEM  DESCRIPTION  QTY  U/P CAD  AMT CAD\nN.W.: 870 KGS  G.W.: 1140 KGS').type).toBe('COMMERCIAL_INVOICE');
  });

  it('does not take an invoice reference on a packing list for a title', () => {
    expect(classifyDocument('Packing List\nAcme Co.   Invoice No. CI/26/0799\nMarks: 1-279\nCarton No.  Packages  Description  Net Weight  Gross Weight  Dimensions (cm)').type).toBe('PACKING_LIST');
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
