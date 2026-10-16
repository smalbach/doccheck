import { describe, expect, it } from 'vitest';
import type { PdfText, TextLine } from './pdf-text';
import { classifyPages, pdfPages, splitDocuments } from './split';

const page = (n: number, ...texts: string[]): TextLine[] => texts.map((text, i) => ({ page: n, text, bbox: [40, 40 + i * 12, 400, 50 + i * 12] }));
const pdf = (...pages: TextLine[][]): PdfText => {
  const lines = pages.flat();
  return { pageCount: pages.length, lines, text: lines.map((l) => l.text).join('\n') };
};

const INVOICE = ['COMMERCIAL INVOICE', 'Invoice No. INV-1', 'Sold to: Maple Retail', 'Unit price   Amount', 'Currency: USD', 'Terms of sale: FOB'];
const PACKING = ['PACKING LIST', 'Packing list no. PL-1', 'C/NO   Description   Meas', 'CBM 11.52'];
const BL = ['BILL OF LADING', 'B/L No. HBL1', 'Port of loading: Yantian', 'Vessel MERIDIAN STAR', 'Notify party', 'Container No  Seal No'];
const AWB = ['AIR WAYBILL 176-12345675', 'Airport of departure SZX', 'Airport of destination YYZ', 'No. of pieces 120', 'Chargeable weight 1920 KG', 'Nature and quantity of goods'];
const COO = ['CERTIFICATE OF ORIGIN', 'Chamber of commerce', 'We hereby certify that the goods originate in China', 'Country of origin: CHINA'];

describe('page splitting', () => {
  it('splits a folder scanned as one PDF into its documents', () => {
    const segments = splitDocuments(pdf(page(1, ...INVOICE), page(2, ...PACKING), page(3, ...BL), page(4, ...COO)));
    expect(segments.map((s) => [s.type, s.pages])).toEqual([
      ['COMMERCIAL_INVOICE', [1]],
      ['PACKING_LIST', [2]],
      ['BILL_OF_LADING', [3]],
      ['CERTIFICATE_OF_ORIGIN', [4]],
    ]);
  });

  it('keeps an untitled second page with the document before it', () => {
    const segments = splitDocuments(pdf(page(1, ...INVOICE), page(2, '5  Wooden puzzle   300 PCS   2.10   630.00', 'Total 49,230.00'), page(3, ...AWB)));
    expect(segments.map((s) => [s.type, s.pages])).toEqual([['COMMERCIAL_INVOICE', [1, 2]], ['AIR_WAYBILL', [3]]]);
  });

  it('starts a document where its own page marker restarts, even of the same type', () => {
    const segments = splitDocuments(
      pdf(page(1, ...INVOICE, 'Page 1 of 2'), page(2, ...INVOICE, 'Page 2 of 2'), page(3, ...INVOICE, 'Page 1 of 1')),
    );
    expect(segments.map((s) => s.pages)).toEqual([[1, 2], [3]]);
  });

  it('ignores a marker that numbers the whole upload', () => {
    const segments = splitDocuments(pdf(page(1, ...INVOICE, 'Page 1 of 3'), page(2, ...PACKING, 'Page 2 of 3'), page(3, 'Total 120 CTNS', 'Page 3 of 3')));
    expect(segments.map((s) => [s.type, s.pages])).toEqual([['COMMERCIAL_INVOICE', [1]], ['PACKING_LIST', [2, 3]]]);
  });

  it('gives an unreadable first page the type of the next one', () => {
    const segments = splitDocuments(pdf(page(1, '~~ ..'), page(2, ...BL)));
    expect(segments.map((s) => [s.type, s.pages])).toEqual([['BILL_OF_LADING', [1, 2]]]);
  });

  it('classifies each page and keeps the page numbers of the upload in a part', () => {
    const whole = pdf(page(1, ...INVOICE), page(2, ...PACKING), page(3, ...BL));
    expect(classifyPages(whole).map((p) => [p.type, p.titled])).toEqual([['COMMERCIAL_INVOICE', true], ['PACKING_LIST', true], ['BILL_OF_LADING', true]]);
    const part = pdfPages(whole, [2, 3]);
    expect(part.lines.every((l) => l.page >= 2)).toBe(true);
    expect(part.text.startsWith('--- page 2 ---\nPACKING LIST')).toBe(true);
    expect(part.text).toContain('--- page 3 ---');
  });
});
