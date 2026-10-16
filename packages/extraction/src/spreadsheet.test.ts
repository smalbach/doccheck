import { describe, expect, it } from 'vitest';
import { LlmClient, type LlmProvider } from './llm';
import { findSource } from './provenance';
import { cellRef, numberText, parseCellRef, readCsv, readSpreadsheet, readXlsx, sheetsToText, writeCsv, writeXlsx, type Sheet } from './spreadsheet';
import { extractSheets, partyFromLines } from './spreadsheet-extract';
import { readZip, writeZip } from './zip';

const invoiceSheet: Sheet = {
  name: 'Invoice',
  rows: [
    ['COMMERCIAL INVOICE'],
    [],
    ['Invoice No.', 'INV-2026-0412', '', 'Date', '2026-10-01'],
    ['PO No.', 'PO-4411', '', 'Currency', 'USD'],
    ['Terms of sale', 'FOB Shenzhen', '', 'Payment terms', 'T/T 30 days'],
    [],
    ['Seller', '', '', 'Buyer'],
    ['Acme Toys Co., Ltd.', '', '', 'Maple Retail Inc.'],
    ['88 Industrial Rd', '', '', '100 King St W'],
    ['Shenzhen, GD 518000', '', '', 'Toronto, ON M5H 1A1'],
    ['China', '', '', 'Canada'],
    [],
    ['No.', 'SKU', 'Description', 'HS code', 'Origin', 'Qty', 'Unit', 'Unit price', 'Amount'],
    ['1', 'TB-200', 'Plush teddy bear 30 cm', '9503.00', 'CN', '6000', 'PCS', '8.10', '48600.00'],
    ['2', 'PZ-500', 'Wooden puzzle 500 pieces', '9503.00', 'CN', '300', 'PCS', '2.10', '630.00'],
    ['', '', 'TOTAL', '', '', '6300', '', '', '49230.00'],
    [],
    ['Packages', '125'],
    ['Gross weight', '1,310 KG'],
  ],
};

describe('zip and xlsx', () => {
  it('reads back what it writes', () => {
    const zip = writeZip({ 'a.txt': 'hello', 'dir/b.xml': '<x/>' });
    const files = readZip(zip);
    expect(files.get('a.txt')!.toString()).toBe('hello');
    expect(files.get('dir/b.xml')!.toString()).toBe('<x/>');
  });

  it('round-trips a sheet through .xlsx, numbers keeping their decimals', () => {
    const [sheet] = readXlsx(writeXlsx([invoiceSheet]));
    expect(sheet.name).toBe('Invoice');
    expect(sheet.rows[13]).toEqual(['1', 'TB-200', 'Plush teddy bear 30 cm', '9503.00', 'CN', '6000', 'PCS', '8.10', '48600.00']);
    expect(sheet.rows[2][1]).toBe('INV-2026-0412');
  });

  it('shows stored floats the way Excel does and reads date serials', () => {
    expect(numberText('8.0999999999999996')).toBe('8.1');
    expect(numberText('48600', 2)).toBe('48600.00');
    const xml = (cells: string) => writeZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/sharedStrings.xml': '<sst><si><r><t>Invoice </t></r><r><t>No.</t></r></si></sst>',
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`,
    });
    const [sheet] = readXlsx(xml('<c r="A1" t="s"><v>0</v></c><c r="C1" s="1"><v>46296</v></c><c r="D1"><v>0.30000000000000004</v></c>'));
    expect(sheet.rows[0]).toEqual(['Invoice No.', '', '2026-10-01', '0.3']);
  });

  it('converts cell references', () => {
    expect(cellRef(11, 2)).toBe('C12');
    expect(cellRef(0, 27)).toBe('AB1');
    expect(parseCellRef('AB1')).toEqual([0, 27]);
  });
});

describe('csv', () => {
  it('parses quotes, embedded delimiters and semicolons', () => {
    expect(readCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
    expect(readCsv('﻿Qty;Price\n10;8,10\n')).toEqual([['Qty', 'Price'], ['10', '8,10']]);
    expect(readCsv(writeCsv(invoiceSheet.rows.map((r) => [...r])))).toEqual(invoiceSheet.rows.map((r) => (r.length ? [...r] : [''])));
  });
});

describe('spreadsheet extraction', () => {
  it('reads an invoice sheet without a model', async () => {
    const out = await extractSheets(readSpreadsheet(writeXlsx([invoiceSheet]), 'invoice.xlsx'), undefined);
    expect(out.documentType).toBe('COMMERCIAL_INVOICE');
    expect(out.issues).toEqual([]);
    const inv = out.data as import('@doccheck/schemas').CommercialInvoice;
    expect(inv.invoiceNumber).toBe('INV-2026-0412');
    expect(inv.invoiceDate).toBe('2026-10-01');
    expect(inv.currency).toBe('USD');
    expect(inv.incoterm).toEqual({ code: 'FOB', place: 'Shenzhen' });
    expect(inv.seller).toMatchObject({ name: 'Acme Toys Co., Ltd.', address: { lines: ['88 Industrial Rd'], city: 'Shenzhen', region: 'GD', postalCode: '518000', country: 'CN' } });
    expect(inv.buyer.address).toMatchObject({ city: 'Toronto', region: 'ON', postalCode: 'M5H 1A1', country: 'CA' });
    expect(inv.lines.map((l) => [l.sku, l.quantity.value, l.unitPrice.amount, l.lineTotal.amount, l.hsCode, l.countryOfOrigin])).toEqual([
      ['TB-200', '6000', '8.10', '48600.00', '9503.00', 'CN'],
      ['PZ-500', '300', '2.10', '630.00', '9503.00', 'CN'],
    ]);
    expect(inv.invoiceTotal).toEqual({ amount: '49230.00', currency: 'USD' });
    expect(inv.packageCount).toBe(125);
    expect(inv.grossWeight?.kg).toBe('1310.00');
    expect(out.table?.columns.I).toBe('lineTotal (Amount)');
  });

  it('cites the cell a value comes from', async () => {
    const pdf = sheetsToText([invoiceSheet]);
    expect(findSource(pdf, 'd1', '48600.00')).toMatchObject({ page: 1, sheet: 'Invoice', cell: 'I14', rawText: '48600.00' });
    expect(findSource(pdf, 'd1', '300')).toMatchObject({ cell: 'F15' });
  });

  it('reads a packing list from a CSV, weights in the unit their header gives', async () => {
    const rows = [
      ['PACKING LIST'],
      ['Packing list no.', 'PL-0412', 'Invoice no.', 'INV-2026-0412'],
      ['C/No.', 'Cartons', 'Description', 'Qty', 'Unit', 'N.W. (LBS)', 'G.W. (LBS)', 'Meas (cm)', 'CBM'],
      ['1-120', '120', 'Plush teddy bear 30 cm', '6000', 'PCS', '2425', '2756', '60x40x40', '11.52'],
      ['TOTAL', '120', '', '6000', '', '2425', '2756', '', '11.52'],
    ];
    const out = await extractSheets(readSpreadsheet(new TextEncoder().encode(writeCsv(rows)), 'packing list.csv'), undefined);
    const pl = out.data as import('@doccheck/schemas').PackingList;
    expect(out.documentType).toBe('PACKING_LIST');
    expect(pl.invoiceRef).toBe('INV-2026-0412');
    expect(pl.packages[0]).toMatchObject({ range: '1-120', count: 120, dimensionsCm: [60, 40, 40] });
    expect(pl.totals).toMatchObject({ packageCount: 120, grossWeight: { kg: '1250.10', raw: { value: '2756', unit: 'LB' } }, volumeM3: '11.52' });
  });

  it('asks the model only for the headers it cannot map, and sends no values', async () => {
    const seen: string[] = [];
    const provider: LlmProvider = {
      id: 'fake:sheet',
      async generate(req) {
        seen.push(req.user);
        return { output: { columns: [{ header: 'Qté expédiée', field: 'quantity' }, { header: 'Valeur', field: 'lineTotal' }] } };
      },
    };
    const sheet: Sheet = { name: 'Facture', rows: [['COMMERCIAL INVOICE'], ['Invoice No.', 'F-1'], ['Désignation', 'Qté expédiée', 'Prix unitaire', 'Valeur'], ['Ours en peluche', '10', '8.10', '81.00']] };
    const out = await extractSheets([sheet], 'COMMERCIAL_INVOICE', { llm: new LlmClient(provider) });
    expect(seen).toEqual([JSON.stringify(['Qté expédiée', 'Valeur'])]);
    expect(out.raw).toMatchObject({ lines: [{ description: 'Ours en peluche', quantity: '10', unitPrice: '8.10', lineTotal: '81.00' }] });
    expect(out.issues).toContain('Columns mapped by the model from their header: "Qté expédiée", "Valeur"');
  });

  it('splits a party block into its parts', () => {
    expect(partyFromLines(['Maple Retail Inc.', '100 King St W', 'Toronto, ON M5H 1A1', 'Canada'])).toEqual({
      name: 'Maple Retail Inc.', addressLines: ['100 King St W'], city: 'Toronto', region: 'ON', postalCode: 'M5H 1A1', country: 'Canada', taxId: null,
    });
  });
});

describe('a workbook with several documents', () => {
  it('splits by sheet and keeps the workbook numbering in citations', async () => {
    const { documentParts, extractPart } = await import('./inputs');
    const packing: Sheet = {
      name: 'Packing List',
      rows: [['PACKING LIST'], ['Packing list no.', 'PL-0412'], ['C/No.', 'Cartons', 'Description', 'Qty', 'G.W. (KG)'], ['1-120', '120', 'Plush teddy bear', '6000', '1250'], ['TOTAL', '120', '', '6000', '1250']],
    };
    const doc = { pdf: sheetsToText([invoiceSheet, packing]), sheets: [invoiceSheet, packing] };
    expect(documentParts(doc).map((s) => [s.type, s.pages])).toEqual([['COMMERCIAL_INVOICE', [1]], ['PACKING_LIST', [2]]]);
    const llm = new LlmClient({ id: 'none', generate: () => Promise.reject(new Error('no model')) });
    const pl = await extractPart(doc, [2], llm);
    expect(pl.documentType).toBe('PACKING_LIST');
    expect(pl.pdf.lines.every((l) => l.page === 2)).toBe(true);
    expect(findSource(pl.pdf, 'd2', '1250')).toMatchObject({ page: 2, sheet: 'Packing List', cell: 'E4' });
  });
});

describe('spreadsheet edge cases', () => {
  it('guesses the delimiter outside quotes and reads UTF-16 exports', async () => {
    const { decodeText } = await import('./spreadsheet');
    expect(readCsv('"Acme, Inc";Qty;Value\n"Bear";10;81\n')[0]).toEqual(['Acme, Inc', 'Qty', 'Value']);
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Qty\tUnit'].flatMap((c) => [c.charCodeAt(0), 0])]);
    expect(decodeText(utf16)).toBe('Qty\tUnit');
  });

  it('maps "Unit value" to the unit price, and reads past spacer rows, subtotals and a goods name with "Total"', async () => {
    const sheet: Sheet = {
      name: 'Invoice',
      rows: [
        ['COMMERCIAL INVOICE'], ['Invoice No.', 'INV-9'], ['Currency', 'USD'],
        ['Description', 'Qty', 'Unit value', 'Total value'],
        ['Total cotton tee', '10', '2.00', '20.00'],
        [],
        ['Plush bear', '5', '8.00', '40.00'],
        ['Subtotal', '', '', '60.00'],
        ['Wooden puzzle', '1', '5.00', '5.00'],
        ['TOTAL', '16', '', '65.00'],
      ],
    };
    const out = await extractSheets([sheet], 'COMMERCIAL_INVOICE');
    expect((out.raw as { lines: { description: string; unitPrice: string }[] }).lines.map((l) => [l.description, l.unitPrice])).toEqual([
      ['Total cotton tee', '2.00'], ['Plush bear', '8.00'], ['Wooden puzzle', '5.00'],
    ]);
    expect((out.raw as { invoiceTotal: string }).invoiceTotal).toBe('65.00');
  });
});
