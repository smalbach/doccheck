import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ctx, invoice, line, testTables } from './__fixtures__/tables';
import { add, dec, fmt } from './decimal';
import { type Cbp7501Draft, type CbsaCadDraft, DRAFT_STATUS, entryDraft } from './entry';
import { estimateDuties } from './estimate';
import { loadDutyTables } from './load';
import { manufacturerId } from './mid';
import { lookupTariff } from './tariff';
import { sampleAirWaybill } from '@doccheck/schemas';

const tables = testTables();

describe('manufacturer ID', () => {
  it('follows the CBP construction', () => {
    expect(manufacturerId({ name: 'Rodex Leather Co., Ltd.', address: { lines: ['1234 Industrial Road'], city: 'Ho Chi Minh City', country: 'VN' } })).toBe('VNRODLEA1234HOC');
    // Articles are skipped, the largest number is cut to 4 digits, Canada uses the province code.
    expect(manufacturerId({ name: 'The Maple Works', address: { lines: ['Unit 7', '123456 Highway 401'], city: 'Toronto', region: 'ON', country: 'CA' } })).toBe('XOMAPWOR1234TOR');
    expect(manufacturerId({ name: 'Zhejiang', address: { lines: [], city: 'Ningbo', country: 'CN' } })).toBe('CNZHENIN');
    expect(manufacturerId({ name: 'X', address: { lines: [] } })).toBeUndefined();
  });
});

describe('draft entry summaries', () => {
  it('prefills a CBP 7501 from the US estimate, marked as a draft', () => {
    const inv = invoice({
      incoterm: { code: 'CIF', place: 'New York' },
      lines: [line(1, '8482.10.50.08', 'CN', '10000.00')],
      charges: { freight: { amount: '800.00', currency: 'USD' }, insurance: { amount: '50.00', currency: 'USD' } },
    });
    const c = ctx('US', inv, { reference: 'PO-77' });
    const e = estimateDuties(c, { relatedParty: false }, tables, { today: '2026-10-16' });
    const d = entryDraft(c, e) as Cbp7501Draft;
    expect(d.form).toBe('CBP Form 7501');
    expect(d.status).toBe(DRAFT_STATUS);
    expect(d.header).toMatchObject({ entryType: '01 Consumption', countryOfOrigin: 'CN', manufacturerId: 'VNRODLEA1234HOC', referenceNumber: 'PO-77', filerCodeEntryNumber: '' });
    expect(d.lines[0]).toMatchObject({ lineNo: '001', htsus: '8482.10.50.08', enteredValue: '9150', charges: '850', relationship: 'N', htsusRate: '9%', duty: '823.50' });
    expect(d.lines[0].chapter99).toEqual([
      { number: '9903.88.01', rate: '25%', amount: '2287.50' },
      { number: '9903.05.31', rate: '12.5%', amount: '1143.75' },
    ]);
    // Box 37 duty (823.50 + 3,431.25), 39 other fees (499 MPF 34.58, 501 HMF 11.44), 40 total.
    expect(d.totals).toEqual({
      duty: '4254.75',
      tax: '0.00',
      other: [
        { classCode: '499', name: 'Merchandise processing fee', amount: '34.58' },
        { classCode: '501', name: 'Harbor maintenance fee', amount: '11.44' },
      ],
      otherTotal: '46.02',
      total: '4300.77',
    });
  });

  it('prefills a CBSA CAD from the CA estimate, with blanks where the suffix is missing', () => {
    const inv = invoice({
      currency: 'EUR',
      incoterm: { code: 'CFR', place: 'Vancouver' },
      buyer: { name: 'Maple Apparel Inc.', address: { lines: ['100 King St W'], city: 'Toronto', region: 'ON', country: 'CA' }, taxId: '123456789RM0001' },
      lines: [line(1, '6109.10.00', 'DE', '20000.00', 'EUR'), line(2, '8509.40', 'DE', '100.00', 'EUR')],
      charges: { freight: { amount: '1500.00', currency: 'EUR' } },
    });
    const c = ctx('CA', inv);
    const e = estimateDuties(c, {}, tables, { today: '2026-10-16' });
    const d = entryDraft(c, e) as CbsaCadDraft;
    expect(d.form).toBe('CBSA CAD (formerly B3-3)');
    expect(d.header).toMatchObject({ importerBusinessNumber: '123456789RM0001', currency: 'EUR', exchangeRate: '1.5', province: 'ON' });
    expect(d.lines[0]).toMatchObject({ classification: '6109.10.00.11', tariffTreatmentCode: '2', vfdCode: '', customsDuty: e.lines[0].duty, gst: e.lines[0].taxes });
    expect(d.lines[1].classification).toBe('8509.40.10.00');
    expect(d.notes.some((n) => n.includes('VFD code left blank'))).toBe(true);
    expect(d.totals.total).toBe(fmt(add(dec(e.totals.duty), dec(e.totals.taxesAtBorder))));
    expect(entryDraft(c, { ...e, status: 'unavailable' })).toBeUndefined();
  });
});

describe('the committed rate tables', () => {
  const root = resolve(__dirname, '../../../data/duties');
  const real = loadDutyTables(root);

  it('load with their source and date', () => {
    expect(real.usHts.meta.revision).toMatch(/HTS/);
    expect(real.caTariff.meta.source).toMatch(/CBSA/);
    expect(real.fxCa.rows.length).toBeGreaterThan(100);
    for (const t of [real.usAdditional, real.caAdditional, real.usFees, real.caTaxes, real.adcvd, real.fta]) {
      expect(t.meta.source).toBeTruthy();
      expect(t.meta.dataDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const e of real.usAdditional.entries) expect(e.source).toBeTruthy();
  });

  it('give the published rates for known lines', () => {
    expect(lookupTariff(real, 'US', '6109.10.00').line?.rates.general.text).toBe('16.5%');
    expect(lookupTariff(real, 'US', '8482.10.50').line?.rates.general.text).toBe('9%');
    expect(lookupTariff(real, 'CA', '6109.10.00').line?.rates.MFN.text).toBe('18 %');
    expect(lookupTariff(real, 'CA', '6109.10.00').line?.rates.CPTPT.text).toBe('Free');
  });

  it('estimate every synthetic shipment without failing', () => {
    const dir = resolve(__dirname, '../../../data/eval/v1');
    if (!existsSync(dir)) return;
    const shipments = readdirSync(dir).filter((x) => /^(CA|US)-\d+$/.test(x));
    expect(shipments.length).toBe(200);
    for (const id of shipments) {
      const t = JSON.parse(readFileSync(resolve(dir, id, 'truth.json'), 'utf8'));
      const docs = t.documents;
      const c = { shipmentId: id, destination: t.destination, invoice: { id: 'inv', data: docs.invoice }, packingList: docs.packingList && { id: 'pl', data: docs.packingList }, billOfLading: docs.billOfLading && { id: 'bl', data: docs.billOfLading } };
      const e = estimateDuties(c, {}, real, { today: '2026-10-16' });
      expect(e.status, id).not.toBe('unavailable');
      expect(entryDraft(c, e), id).toBeDefined();
    }
  });
});

describe('draft entry of an air shipment', () => {
  it('takes the waybill number, flight and airports', () => {
    const c = ctx('US', invoice({ lines: [line(1, '8482.10.50.08', 'CN', '1000.00')] }), { transportMode: undefined, airWaybill: { id: 'awb-1', data: { ...sampleAirWaybill, flights: [{ flight: 'CA1234', date: '2026-03-23' }] } } });
    const d = entryDraft(c, estimateDuties(c, {}, tables, { today: '2026-10-16' })) as Cbp7501Draft;
    expect(d.header).toMatchObject({ blOrAwbNumber: '176-12345675', modeOfTransport: '40 Air', exportDate: '2026-03-23', importingCarrier: 'Example Air Cargo / CA1234' });
    expect(d.header.foreignPortOfLading).toContain('SZX');
  });
});
