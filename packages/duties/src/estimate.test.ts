import { describe, expect, it } from 'vitest';
import { ctx, invoice, line, testTables } from './__fixtures__/tables';
import { sampleAirWaybill, sampleCusmaCertification } from '@doccheck/schemas';
import { cusmaElements, estimateDuties } from './estimate';
import { exchangeRate } from './fx';
import { lookupTariff } from './tariff';
import { CUSMA_ELEMENTS, type DutyInputs } from './types';

const tables = testTables();
const run = (c: ReturnType<typeof ctx>, inputs: DutyInputs = {}, today = '2026-10-16') => estimateDuties(c, inputs, tables, { today });
const codes = (e: ReturnType<typeof run>) => e.findings.map((f) => f.code);
const answered: DutyInputs = { relatedParty: false, assists: { amount: '0', currency: 'USD' }, royalties: { amount: '0', currency: 'USD' } };

describe('tariff lookup', () => {
  it('finds the rate line from 10, 8 or 6 digits', () => {
    expect(lookupTariff(tables, 'US', '8482.10.50.08')).toMatchObject({ match: 'exact', line: { code: '8482.10.50', classification: '8482.10.50.08' } });
    expect(lookupTariff(tables, 'US', '8482105004').line?.classification).toBe('8482.10.50.04');
    expect(lookupTariff(tables, 'US', '8482.10').match).toBe('several');
    // One rate line under the subheading, and one statistical line under it.
    expect(lookupTariff(tables, 'US', '6109.10')).toMatchObject({ match: 'single', line: { code: '6109.10.00', classification: '6109.10.00.04' } });
    expect(lookupTariff(tables, 'CA', '6109.10.00')).toMatchObject({ match: 'exact', line: { code: '6109.10.00', units: ['NMB'] } });
    expect(lookupTariff(tables, 'CA', '9999.99').match).toBe('none');
  });
});

describe('exchange rates', () => {
  it('uses the last business day when the date has no rate', () => {
    expect(exchangeRate(tables, 'CA', 'USD', '2026-03-22')).toMatchObject({ date: '2026-03-20', published: '1.4000' });
    expect(exchangeRate(tables, 'US', 'CNY', '2026-03-21')).toMatchObject({ date: '2026-03-20', direction: 'CNY per USD' });
    expect(exchangeRate(tables, 'CA', 'USD', '2026-01-01')).toBeUndefined();
  });
});

describe('US: transaction value, duty, Section 301, MPF and HMF', () => {
  // Worked example: CIF New York, 10,000.00 USD of Chinese ball bearings (HTSUS 8482.10.50.08, 9 %),
  // freight 800.00 and insurance 50.00 shown on the invoice and included in the price.
  //   entered value       10,000 - 800 - 50                      =  9,150
  //   duty                9 % of 9,150                           =    823.50
  //   Section 301 List 1  25 % of 9,150                          =  2,287.50
  //   301 forced labor    12.5 % of 9,150                        =  1,143.75
  //   MPF                 0.3464 % = 31.70, below the minimum    =     34.58
  //   HMF                 0.125 % of 9,150 = 11.4375             =     11.44
  //   landed cost         9,150 + 800 + 50 + 823.50 + 2,287.50 + 1,143.75 + 34.58 + 11.44 = 14,300.77
  const cif = invoice({
    incoterm: { code: 'CIF', place: 'New York' },
    lines: [line(1, '8482.10.50.08', 'CN', '10000.00')],
    charges: { freight: { amount: '800.00', currency: 'USD' }, insurance: { amount: '50.00', currency: 'USD' } },
  });

  it('works the example through', () => {
    const e = run(ctx('US', cif), answered);
    expect(e.status).toBe('ok');
    expect(e.valuation.chargesOnInvoice).toBe('included');
    expect(e.valuation.adjustments.map((a) => [a.kind, a.amount])).toEqual([
      ['deduct-freight', '-800.00'],
      ['deduct-insurance', '-50.00'],
    ]);
    const [l] = e.lines;
    expect(l).toMatchObject({ dutiableValue: '9150.00', rate: '9%', duty: '823.50', goods: '9150.00', freight: '800.00', insurance: '50.00' });
    expect(l.additional.map((a) => [a.id, a.percent, a.amount])).toEqual([
      ['301-CN-LIST1', '25', '2287.50'],
      ['301-FL-CN', '12.5', '1143.75'],
    ]);
    expect(e.fees.map((f) => [f.code, f.amount])).toEqual([
      ['MPF', '34.58'],
      ['HMF', '11.44'],
    ]);
    expect(e.totals).toMatchObject({ dutiableValue: '9150.00', duty: '823.50', additional: '3431.25', fees: '46.02', payableAtBorder: '4300.77', landedCost: '14300.77', complete: true });
    // Only the unverified forced-labor entry is left to confirm.
    expect(codes(e)).toEqual(['D10']);
  });

  it('flags CIF freight and insurance that are not shown, and leaves the value overstated', () => {
    const e = run(ctx('US', invoice({ incoterm: { code: 'CIF', place: 'New York' }, lines: [line(1, '8482.10.50.08', 'CN', '10000.00')] })), answered);
    expect(e.findings.filter((f) => f.code === 'D1').map((f) => f.asks)).toEqual(['freight', 'insurance']);
    expect(e.lines[0].dutiableValue).toBe('10000.00');
    // Entering the freight and insurance deducts them.
    const fixed = run(ctx('US', invoice({ incoterm: { code: 'CIF', place: 'New York' }, lines: [line(1, '8482.10.50.08', 'CN', '10000.00')] })), { ...answered, freight: { amount: '800', currency: 'USD' }, insurance: { amount: '50', currency: 'USD' } });
    expect(fixed.lines[0].dutiableValue).toBe('9150.00');
    expect(codes(fixed)).not.toContain('D1');
  });

  it('takes an FOB price as is and adds the buyer’s freight only to the landed cost', () => {
    const e = run(ctx('US', invoice({ lines: [line(1, '8482.10.50.08', 'CN', '10000.00')] })), { ...answered, freight: { amount: '900', currency: 'USD' } });
    expect(e.lines[0]).toMatchObject({ dutiableValue: '10000.00', freight: '900.00', goods: '10000.00' });
  });

  it('adds packing charged on top of the lines, assists and royalties', () => {
    const inv = invoice({ lines: [line(1, '8482.10.50.08', 'CN', '1000.00')], charges: { packing: { amount: '25.00', currency: 'USD' } } });
    inv.invoiceTotal = { amount: '1025.00', currency: 'USD' };
    const e = run(ctx('US', inv), { relatedParty: false, assists: { amount: '100', currency: 'USD' }, royalties: { amount: '50', currency: 'USD' } });
    expect(e.valuation.chargesOnInvoice).toBe('separate');
    expect(e.valuation.adjustments.map((a) => a.kind)).toEqual(['add-packing', 'add-assists', 'add-royalties']);
    expect(e.lines[0].dutiableValue).toBe('1175.00');
    expect(codes(e)).not.toContain('D4');
  });

  it('asks about related parties, assists and royalties until answered', () => {
    const e = run(ctx('US', invoice({ lines: [line(1, '8482.10.50.08', 'CN', '1000.00')] })));
    expect(e.findings.filter((f) => f.code === 'D3' || f.code === 'D4').map((f) => [f.code, f.severity, f.asks])).toEqual([
      ['D4', 'LOW', 'assists'],
      ['D3', 'LOW', 'relatedParty'],
    ]);
    const related = run(ctx('US', invoice({ lines: [line(1, '8482.10.50.08', 'CN', '1000.00')] })), { ...answered, relatedParty: true });
    expect(related.findings.find((f) => f.code === 'D3')?.severity).toBe('MEDIUM');
  });

  it('tops EU goods up to the 10 % floor and adds nothing when the duty reaches it', () => {
    const e = run(ctx('US', invoice({ lines: [line(1, '8481.80.90.50', 'DE', '1000.00'), line(2, '6109.10.00.04', 'IT', '1000.00')] })), answered);
    expect(e.lines[0]).toMatchObject({ duty: '20.00', additionalTotal: '80.00' });
    expect(e.lines[0].additional[0]).toMatchObject({ id: '301-FL-EU', percent: '8' });
    expect(e.lines[1]).toMatchObject({ duty: '165.00', additionalTotal: '0.00', additional: [] });
  });

  it('charges Section 232 on the metal content, and drops the 301 forced-labor duty for 232 goods', () => {
    const inv = invoice({ lines: [line(1, '8481.80.30.00', 'CN', '2000.00')] });
    const e = run(ctx('US', inv), answered);
    expect(e.lines[0]).toMatchObject({ duty: '240.00', additionalTotal: '1000.00' });
    expect(e.lines[0].additional.map((a) => a.id)).toEqual(['232-STEEL']);
    expect(e.findings.find((f) => f.code === 'D10')?.asks).toBe('metalContent');
    const withMetal = run(ctx('US', inv), { ...answered, metalContent: { '1': { amount: '600', currency: 'USD' } } });
    expect(withMetal.lines[0].additional[0]).toMatchObject({ base: '600.00', amount: '300.00', basis: 'metalContent' });
  });

  it('charges a per-kg duty on the net weight from the packing list', () => {
    const inv = invoice({ lines: [line(1, '1509.20.20.00', 'IT', '13568.00', 'USD', { value: '400', unit: 'PCS' }, 'OO-5'), line(2, '8482.10.50.08', 'IT', '100.00')] });
    const pl = { packages: [{ range: '1-100', count: 100, type: 'CTN' as const, contents: [{ sku: 'OO-5', description: 'Olive oil', quantity: { value: '400', unit: 'PCS' } }], netWeight: { kg: '1840.00', raw: { value: '1840', unit: 'KG' } } }], totals: { packageCount: 100 } };
    const e = run(ctx('US', inv, { packingList: { id: 'pl-1', data: pl } }), answered);
    expect(e.lines[0]).toMatchObject({ netKg: '1840.000', rate: '0.05/kg', duty: '92.00' });
    // Without the packing list the quantity in kg is unknown: no guess.
    const noPl = run(ctx('US', inv), answered);
    expect(noPl.lines[0].duty).toBeUndefined();
    expect(noPl.status).toBe('partial');
    expect(noPl.findings.find((f) => f.code === 'D11')?.lineNo).toBe(1);
  });

  it('applies USMCA when claimed with a complete certification: no duty, no MPF, no 301 duty', () => {
    const all = Object.fromEntries(CUSMA_ELEMENTS.map((k) => [k, true]));
    const inv = invoice({ lines: [line(1, '8482.10.50.08', 'CA', '300000.00'), line(2, '8482.10.50.08', 'CN', '250000.00')] });
    const e = run(ctx('US', inv), { ...answered, preference: { agreement: 'CUSMA', certification: all } });
    expect(e.lines[0]).toMatchObject({ treatment: { code: 'S', agreement: 'CUSMA' }, duty: '0.00', additional: [] });
    // MPF only on the Chinese line: 0.3464 % of 250,000 = 866.00, capped at 670.86.
    expect(e.fees.find((f) => f.code === 'MPF')).toMatchObject({ base: '250000.00', amount: '670.86' });
    expect(e.preference).toMatchObject({ agreement: 'CUSMA', lines: [1], certification: 'complete' });
    expect(codes(e)).not.toContain('D7');
  });

  it('converts at the H.10 rate of the export date and applies the rules in force on the entry date', () => {
    // 7,100.00 CNY at 7.1000 CNY per USD (2026-03-20, the Friday before the Saturday export) = 1,000 USD.
    // Entry on 2026-03-25: Section 122 (10 %) was in force, the forced-labor duty not yet; MPF FY2026 minimum.
    const inv = invoice({ currency: 'CNY', shipmentDate: '2026-03-21', lines: [line(1, '8482.10.50.08', 'CN', '7100.00', 'CNY')] });
    const e = run(ctx('US', inv), { ...answered, entryDate: '2026-03-25' });
    expect(e.exchange[0]).toMatchObject({ from: 'CNY', date: '2026-03-20', requestedDate: '2026-03-21', published: '7.1000' });
    expect(e.lines[0]).toMatchObject({ dutiableValue: '1000.00', duty: '90.00', additionalTotal: '350.00' });
    expect(e.lines[0].additional.map((a) => a.id)).toEqual(['301-CN-LIST1', '122-GLOBAL']);
    expect(e.fees[0]).toMatchObject({ code: 'MPF', amount: '33.58' });
    expect(e.fees[0].note).toContain('informal entry');
  });

  it('has no estimate without an exchange rate for the invoice currency, unless one is entered', () => {
    const inv = invoice({ currency: 'GBP', lines: [line(1, '8482.10.50.08', 'CN', '1000.00', 'GBP')] });
    const e = run(ctx('US', inv));
    expect(e.status).toBe('unavailable');
    expect(e.findings[0]).toMatchObject({ code: 'D6', severity: 'HIGH', asks: 'exchangeRates' });
    const manual = run(ctx('US', inv), { ...answered, exchangeRates: { GBP: '1.2500' } });
    expect(manual.lines[0].dutiableValue).toBe('1250.00');
    expect(manual.exchange[0].manual).toBe(true);
  });

  it('flags an AD/CVD case by HS and origin without computing it', () => {
    const e = run(ctx('US', invoice({ lines: [line(1, '6907.21.90.00', 'CN', '5000.00')] })), answered);
    expect(e.findings.find((f) => f.code === 'D9')).toMatchObject({ severity: 'HIGH' });
    expect(e.lines[0].adcvd).toEqual(['A-570-108']);
  });

  it('uses the highest rate when 6 digits cover several lines, and the entered number when given', () => {
    const inv = invoice({ lines: [line(1, '8482.10', 'CN', '1000.00')] });
    const e = run(ctx('US', inv), answered);
    expect(e.lines[0].tariff).toMatchObject({ code: '8482.10.50', match: 'several' });
    expect(e.findings.find((f) => f.code === 'D5')).toMatchObject({ severity: 'MEDIUM', asks: 'tariffNumbers' });
    const classified = run(ctx('US', inv), { ...answered, tariffNumbers: { '1': '8482.10.10.00' } });
    expect(classified.lines[0]).toMatchObject({ rate: '2.4%', duty: '24.00', tariff: { match: 'exact', classification: '8482.10.10.00' } });
  });

  it('cannot estimate a line without an HS code or origin', () => {
    const e = run(ctx('US', invoice({ lines: [line(1, undefined, 'CN', '100.00'), line(2, '8482.10.50.08', undefined, '100.00')] })), answered);
    expect(e.status).toBe('partial');
    expect(e.findings.filter((f) => f.code === 'D5' || f.code === 'D13').map((f) => [f.code, f.lineNo])).toEqual([
      ['D5', 1],
      ['D13', 2],
    ]);
    expect(e.totals.complete).toBe(false);
  });
});

describe('CA: value for duty, MFN and preferences, GST and HST', () => {
  // Worked example: CFR Vancouver, 20,000.00 EUR of German cotton T-shirts (6109.10.00, MFN 18 %,
  // CEUT free), freight 1,500.00 EUR shown and included, 1 EUR = 1.5000 CAD on the shipped-on-board
  // date, consignee in Ontario.
  //   value for duty    (20,000 - 1,500) × 1.5               = 27,750.00
  //   duty              18 %                                 =  4,995.00
  //   GST               5 % of (27,750 + 4,995) = 32,745.00  =  1,637.25
  //   HST, provincial   8 % of 32,745.00, self-assessed      =  2,619.60
  //   landed cost       27,750 + 2,250 freight + 4,995 + 1,637.25 = 36,632.25
  const cfr = invoice({
    currency: 'EUR',
    incoterm: { code: 'CFR', place: 'Vancouver' },
    seller: { name: 'Textil GmbH', address: { lines: ['Hauptstrasse 5'], city: 'Bremen', country: 'DE' } },
    buyer: { name: 'Maple Apparel Inc.', address: { lines: ['100 King St W'], city: 'Toronto', region: 'ON', country: 'CA' } },
    lines: [line(1, '6109.10.00', 'DE', '20000.00', 'EUR')],
    charges: { freight: { amount: '1500.00', currency: 'EUR' } },
  });

  it('works the example through', () => {
    const e = run(ctx('CA', cfr), answered);
    expect(e.exchange[0]).toMatchObject({ from: 'EUR', to: 'CAD', published: '1.5000', date: '2026-03-20' });
    expect(e.lines[0]).toMatchObject({ dutiableValue: '27750.00', treatment: { code: 'MFN', cadCode: '2' }, rate: '18%', duty: '4995.00', taxes: '1637.25', selfAssessedTaxes: '2619.60', landedCost: '36632.25' });
    expect(e.taxes.map((t) => [t.code, t.base, t.percent, t.amount, t.atBorder])).toEqual([
      ['GST', '32745.00', '5', '1637.25', true],
      ['HST', '32745.00', '8', '2619.60', false],
    ]);
    expect(e.province).toEqual({ code: 'ON', name: 'Ontario', from: 'buyer' });
    expect(e.totals).toMatchObject({ payableAtBorder: '6632.25', selfAssessedTaxes: '2619.60', landedCost: '36632.25' });
    // CETA would save the whole duty if the goods qualify.
    expect(e.findings.find((f) => f.code === 'D8')?.message).toContain('4995.00 CAD');
  });

  it('applies CETA when claimed with the proof on file, and flags the claim without it', () => {
    const e = run(ctx('CA', cfr), { ...answered, preference: { agreement: 'CETA', proofOnFile: true } });
    expect(e.lines[0]).toMatchObject({ treatment: { code: 'CEUT', agreement: 'CETA' }, duty: '0.00', taxes: '1387.50' });
    expect(codes(e)).not.toContain('D8');
    expect(codes(e)).not.toContain('D7');
    const noProof = run(ctx('CA', cfr), { ...answered, preference: { agreement: 'CETA' } });
    expect(noProof.findings.find((f) => f.code === 'D7')).toMatchObject({ severity: 'HIGH' });
  });

  it('adds inland freight to the place of direct shipment under EXW, and asks for it until given', () => {
    const exw = invoice({
      incoterm: { code: 'EXW', place: 'Ningbo factory' },
      buyer: { name: 'Quincaillerie Inc.', address: { lines: ['1 rue X'], city: 'Montréal', region: 'Québec', country: 'CA' } },
      lines: [line(1, '7318.15.00.10', 'CN', '1000.00')],
    });
    const asked = run(ctx('CA', exw), answered);
    expect(asked.findings.find((f) => f.code === 'D2')).toMatchObject({ severity: 'MEDIUM', asks: 'inlandFreight' });
    // (1,000 + 200) USD × 1.4000 = 1,680.00 CAD; free; GST 84.00; QST is not collected at the border.
    const e = run(ctx('CA', exw), { ...answered, inlandFreight: { amount: '200', currency: 'USD' } });
    expect(e.lines[0]).toMatchObject({ dutiableValue: '1680.00', duty: '0.00', taxes: '84.00', goods: '1400.00', other: '280.00', landedCost: '1764.00' });
    expect(e.taxes.map((t) => [t.code, t.amount])).toEqual([
      ['GST', '84.00'],
      ['PST', undefined],
    ]);
    expect(codes(e)).not.toContain('D2');
  });

  it('checks the nine CUSMA data elements and where the goods were loaded', () => {
    const us = invoice({ lines: [line(1, '6109.10.00', 'US', '1000.00')] });
    const bl = { blNumber: 'B1', shipper: us.seller, consignee: us.buyer, portOfLoading: { name: 'Busan', country: 'KR' }, portOfDischarge: { name: 'Vancouver', country: 'CA' }, containers: [], totalPackages: 1, totalGrossWeight: { kg: '1', raw: { value: '1', unit: 'KG' } }, cargoDescription: 'x', shippedOnBoardDate: '2026-03-20' };
    const partial = Object.fromEntries(CUSMA_ELEMENTS.filter((k) => k !== 'producer' && k !== 'blanketPeriod').map((k) => [k, true]));
    const e = run(ctx('CA', us, { billOfLading: { id: 'bl-1', data: bl } }), { ...answered, preference: { agreement: 'CUSMA', certification: partial } });
    expect(e.lines[0]).toMatchObject({ treatment: { code: 'UST', cadCode: '10' }, duty: '0.00' });
    expect(e.preference).toMatchObject({ certification: 'incomplete', missingElements: ['producer', 'blanketPeriod'] });
    expect(e.findings.filter((f) => f.code === 'D7').map((f) => f.severity)).toEqual(['MEDIUM', 'LOW']);
    expect(e.cusma).toEqual([{ lineNo: 1, origin: 'US', hint: 'Yarn forward.' }]);
    // Without a certification the claim is high severity; without a claim the saving is pointed out.
    expect(run(ctx('CA', us), { ...answered, preference: { agreement: 'CUSMA' } }).findings[0]).toMatchObject({ code: 'D7', severity: 'HIGH' });
    expect(codes(run(ctx('CA', us), answered))).toContain('D8');
  });

  it('flags a claim no line can use', () => {
    const e = run(ctx('CA', invoice({ lines: [line(1, '6109.10.00', 'CN', '1000.00')] })), { ...answered, preference: { agreement: 'CUSMA' } });
    expect(e.findings[0]).toMatchObject({ code: 'D7', severity: 'HIGH' });
    expect(e.lines[0].treatment.code).toBe('MFN');
  });

  it('charges a per-litre duty and flags excise on wine', () => {
    // 500 L at 4.68¢/L = 23.40 CAD
    const e = run(ctx('CA', invoice({ lines: [line(1, '2204.21.21.00', 'IT', '1000.00', 'USD', { value: '500', unit: 'LTR' })] })), answered);
    expect(e.lines[0]).toMatchObject({ rate: '0.0468/l', duty: '23.40' });
    expect(codes(e)).toContain('D12');
  });

  it('uses the highest of several tariff items, and needs the province for the HST', () => {
    const e = run(ctx('CA', invoice({ lines: [line(1, '8509.40', 'CN', '1000.00')] })), answered);
    expect(e.lines[0].tariff).toMatchObject({ code: '8509.40.10', match: 'several' });
    expect(e.findings.find((f) => f.code === 'D14')).toMatchObject({ asks: 'province' });
    const ns = (date: string) => run(ctx('CA', invoice({ lines: [line(1, '7318.15.00.10', 'CN', '1000.00')] })), { ...answered, province: 'NS', entryDate: date }).taxes.find((t) => t.code === 'HST')?.percent;
    expect(ns('2025-03-01')).toBe('10');
    expect(ns('2026-03-25')).toBe('9');
  });
});

describe('documents added on main: CUSMA certification, air waybill, other destinations', () => {
  it('reads the nine data elements from an uploaded CUSMA certification', () => {
    expect(cusmaElements(sampleCusmaCertification)).toEqual({
      certifierRole: true, certifier: true, exporter: true, producer: true, importer: true, descriptionAndHs: true, originCriterion: true, blanketPeriod: true, signatureAndDate: true,
    });
    const { signature: _s, ...unsigned } = sampleCusmaCertification;
    expect(cusmaElements({ ...unsigned, goods: [{ description: 'Bear', hsCode: '9503' }] })).toMatchObject({ signatureAndDate: false, descriptionAndHs: false, originCriterion: false });
  });

  it('accepts a CUSMA claim on the uploaded certification, and names what it lacks', () => {
    const us = invoice({ lines: [line(1, '6109.10.00', 'US', '1000.00')] });
    const cert = { id: 'cert-1', data: sampleCusmaCertification };
    const ok = run(ctx('CA', us, { cusmaCertification: cert }), { ...answered, preference: { agreement: 'CUSMA' } });
    expect(ok.preference).toMatchObject({ certification: 'complete', documentId: 'cert-1' });
    expect(codes(ok)).not.toContain('D7');
    const { signature: _s, ...unsigned } = sampleCusmaCertification;
    const lacking = run(ctx('CA', us, { cusmaCertification: { id: 'cert-1', data: unsigned } }), { ...answered, preference: { agreement: 'CUSMA' } });
    expect(lacking.preference?.missingElements).toEqual(['signatureAndDate']);
    expect(lacking.findings.find((f) => f.code === 'D7')?.evidence[0].documentId).toBe('cert-1');
    // Not claimed although the certification is there: the saving says so.
    expect(run(ctx('CA', us, { cusmaCertification: cert }), answered).findings.find((f) => f.code === 'D8')?.message).toContain('certification of origin is among');
  });

  it('dates an air shipment by its flight and charges no harbor maintenance fee', () => {
    const inv = invoice({ shipmentDate: undefined, lines: [line(1, '8482.10.50.08', 'CN', '1000.00')] });
    const awb = { ...sampleAirWaybill, flights: [{ flight: 'CA1234', date: '2026-03-23' }] };
    const e = run(ctx('US', inv, { transportMode: undefined, airWaybill: { id: 'awb-1', data: awb } }), answered);
    expect(e.fees.map((f) => f.code)).toEqual(['MPF']);
    const eur = run(ctx('US', invoice({ currency: 'EUR', shipmentDate: undefined, lines: [line(1, '8482.10.50.08', 'DE', '1000.00', 'EUR')] }), { transportMode: undefined, airWaybill: { id: 'awb-1', data: awb } }), answered);
    expect(eur.exchange[0]).toMatchObject({ date: '2026-03-23', published: '1.0900' });
  });

  it('gives no numbers for destinations without rate tables', () => {
    for (const destination of ['MX', 'EU', 'GB'] as const) {
      const e = estimateDuties({ ...ctx('US', invoice({ lines: [line(1, '8482.10.50.08', 'CN', '1000.00')] })), destination }, {}, tables, { today: '2026-10-16' });
      expect(e.status).toBe('unavailable');
      expect(e.unavailableReason).toContain('No duty estimate for this destination');
      expect(e.lines).toEqual([]);
    }
  });
});
