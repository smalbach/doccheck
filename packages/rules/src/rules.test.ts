import { describe, expect, it } from 'vitest';
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { fromFixed, mul, withinTolerance } from './decimal';
import { runRules, type RuleProgress } from './engine';
import { iso6346CheckDigit, isValidContainerNumber } from './rules/x10-container-check-digit';
import type { ShipmentContext } from './types';

const clean = (): ShipmentContext =>
  structuredClone({
    shipmentId: 'shp-1',
    destination: 'CA',
    invoice: { id: 'inv-1', data: sampleInvoice },
    packingList: { id: 'pl-1', data: samplePackingList },
    billOfLading: { id: 'bl-1', data: sampleBillOfLading },
  });

const ruleIds = (ctx: ShipmentContext) => runRules(ctx).findings.map((f) => f.ruleId);

describe('decimal helpers', () => {
  it('multiplies without float errors', () => {
    expect(fromFixed(mul('0.1', '3'))).toBe('0.30');
    expect(fromFixed(mul('6000', '8.10'))).toBe('48600.00');
  });
  it('applies relative tolerance', () => {
    expect(withinTolerance('1000', '1004', 0.005)).toBe(true);
    expect(withinTolerance('1000', '1010', 0.005)).toBe(false);
  });
});

describe('ISO 6346', () => {
  it('computes the check digit of the reference container', () => {
    expect(iso6346CheckDigit('CSQU305438')).toBe(3);
    expect(isValidContainerNumber('CSQU3054383')).toBe(true);
    expect(isValidContainerNumber('CSQU3054384')).toBe(false);
  });
});

describe('rule engine', () => {
  it('finds nothing on a clean shipment', () => {
    const out = runRules(clean());
    expect(out.findings).toEqual([]);
    expect(out.ran).toEqual(['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X12', 'C1', 'C2', 'T10', 'T11']);
  });

  it('reports each rule in order, skipped ones included, and survives a broken hook', () => {
    const ctx = clean();
    ctx.billOfLading!.data.totalPackages = 121;
    delete ctx.packingList;
    const seen: RuleProgress[] = [];
    const out = runRules(ctx, {}, { onRule: (p) => void seen.push(p) });
    expect(seen.map((p) => p.index)).toEqual(seen.map((_, i) => i + 1));
    expect(seen.every((p) => p.total === seen.length)).toBe(true);
    expect(seen.length).toBe(out.ran.length + out.skipped.length + out.notApplicable!.length);
    expect(seen.filter((p) => p.skipped && !p.notApplicable).map((p) => p.rule)).toEqual(out.skipped.map((s) => s.ruleId));
    expect(seen.filter((p) => p.notApplicable).map((p) => p.rule)).toEqual(out.notApplicable);
    expect(seen.reduce((n, p) => n + p.findings, 0)).toBe(out.findings.length);
    expect(seen.flatMap((p) => p.found)).toEqual(out.findings);
    expect(seen.every((p) => p.found.length === p.findings && p.found.every((f) => f.ruleId === p.rule))).toBe(true);
    const thrown = runRules(ctx, {}, { onRule: () => { throw new Error('boom'); } });
    expect(thrown.findings).toEqual(out.findings);
  });

  it('X2: flags a package count mismatch', () => {
    const ctx = clean();
    ctx.billOfLading!.data.totalPackages = 121;
    expect(ruleIds(ctx)).toContain('X2');
  });

  it('X3: flags a gross weight outside tolerance', () => {
    const ctx = clean();
    ctx.billOfLading!.data.totalGrossWeight = { kg: '1300', raw: { value: '1300', unit: 'KG' } };
    expect(ruleIds(ctx)).toContain('X3');
  });

  it('X4: flags net weight above gross', () => {
    const ctx = clean();
    ctx.invoice!.data.netWeight = { kg: '1300', raw: { value: '1300', unit: 'KG' } };
    expect(ruleIds(ctx)).toEqual(['X4']);
  });

  it('X5: flags a wrong line total and a wrong invoice total', () => {
    const ctx = clean();
    ctx.invoice!.data.lines[0].lineTotal.amount = '48000.00';
    const x5 = runRules(ctx).findings.filter((f) => f.ruleId === 'X5');
    expect(x5).toHaveLength(2);
  });

  it('X6: flags a second currency', () => {
    const ctx = clean();
    ctx.invoice!.data.charges = { freight: { amount: '1200.00', currency: 'CNY' } };
    expect(ruleIds(ctx)).toEqual(['X6']);
  });

  it('X10: flags a mistyped container number', () => {
    const ctx = clean();
    ctx.billOfLading!.data.containers[0].number = 'CSQU3054384';
    expect(ruleIds(ctx)).toEqual(['X10']);
  });

  it('skips cross-document rules when the BL is missing', () => {
    const ctx = clean();
    delete ctx.billOfLading;
    const out = runRules(ctx);
    expect(out.skipped.map((s) => s.ruleId)).toEqual(['X1', 'X2', 'X3', 'X9', 'X10', 'X12']);
  });

  it('X1: ignores formatting but flags a different street', () => {
    const ctx = clean();
    ctx.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, name: 'MAPLE RETAIL INC', address: { ...sampleBillOfLading.consignee.address, lines: ['100 KING STREET WEST'] } };
    expect(ruleIds(ctx)).toEqual([]);
    ctx.billOfLading!.data.consignee.address.lines = ['110 King St W'];
    const x1 = runRules(ctx).findings.filter((f) => f.ruleId === 'X1');
    expect(x1).toHaveLength(1);
    expect(x1[0].evidence.map((e) => e.field)).toEqual(['consignee.address.lines[0]', 'consignee.address.lines[0]']);
  });

  it('X1: a country one document does not show is not a difference', () => {
    const ctx = clean();
    const { country: _c, ...address } = sampleBillOfLading.consignee.address;
    ctx.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, address };
    expect(ruleIds(ctx)).toEqual([]);
    ctx.billOfLading!.data.consignee.address.country = 'US';
    expect(ruleIds(ctx)).toEqual(['X1']);
  });

  it('X1: ignores locality lines copied into the street lines', () => {
    const ctx = clean();
    const a = sampleBillOfLading.consignee.address;
    ctx.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, address: { ...a, lines: [...a.lines, 'Toronto, ON', 'CA'] } };
    expect(ruleIds(ctx)).toEqual([]);
  });

  it('X1: skips a BL consigned to order', () => {
    const ctx = clean();
    ctx.billOfLading!.data.consignee = { name: 'TO ORDER OF BANK OF EXAMPLE', address: { lines: [], country: 'CA' } };
    expect(ruleIds(ctx)).toEqual([]);
  });

  it('X7: flags a packing list quantity that differs from the invoice', () => {
    const ctx = clean();
    ctx.packingList!.data.packages[0].contents[0].quantity.value = '5990';
    const x7 = runRules(ctx).findings.filter((f) => f.ruleId === 'X7');
    expect(x7).toHaveLength(1);
    expect(x7[0].message).toContain('6000 on the invoice, 5990 on the packing list');
  });

  it('X8: flags a packing list for another invoice', () => {
    const ctx = clean();
    ctx.packingList!.data.invoiceRef = 'INV-2026-0413';
    expect(ruleIds(ctx)).toEqual(['X8']);
  });

  it('X9: tolerates a few days between invoice and BL dates, not weeks', () => {
    const ctx = clean();
    ctx.billOfLading!.data.shippedOnBoardDate = '2026-10-09';
    expect(ruleIds(ctx)).toEqual([]);
    ctx.billOfLading!.data.shippedOnBoardDate = '2026-11-02';
    const x9 = runRules(ctx).findings.filter((f) => f.ruleId === 'X9');
    expect(x9[0].message).toContain('28 days later');
  });

  it('X12: flags a CIF invoice on a freight collect BL, not an FOB one', () => {
    const ctx = clean();
    expect(ruleIds(ctx)).toEqual([]); // FOB + COLLECT
    ctx.invoice!.data.incoterm = { code: 'CIF', place: 'Vancouver' };
    expect(ruleIds(ctx)).toEqual(['X12']);
    ctx.billOfLading!.data.freightTerms = 'PREPAID';
    expect(ruleIds(ctx)).toEqual([]);
  });

  it('C1: reports each field CBSA requires that is missing', () => {
    const ctx = clean();
    delete ctx.invoice!.data.incoterm;
    delete ctx.invoice!.data.lines[0].countryOfOrigin;
    const c1 = runRules(ctx).findings.filter((f) => f.ruleId === 'C1');
    expect(c1.map((f) => f.evidence[0].field)).toEqual(['lines[0].countryOfOrigin', 'incoterm']);
    expect(c1[0].severity).toBe('HIGH');
  });

  it('C2: flags an invoice in a language CBSA does not accept', () => {
    const ctx = clean();
    ctx.invoice!.data.language = 'zh';
    expect(ruleIds(ctx)).toEqual(['C2']);
  });

  it('U1 and X11 run for the US profile', () => {
    const ctx: ShipmentContext = { ...clean(), destination: 'US' };
    ctx.invoice!.data.portOfEntry = { name: 'Los Angeles', unLocode: 'USLAX', country: 'US' };
    const isf = {
      seller: sampleInvoice.seller, buyer: sampleInvoice.buyer, importerOfRecordNumber: '12-345678900', consigneeNumber: '12-345678900',
      manufacturer: sampleInvoice.seller, shipToParty: sampleInvoice.buyer, countryOfOrigin: 'CN', htsCode: '950300',
      containerStuffingLocation: sampleInvoice.seller.address, consolidator: sampleInvoice.seller,
    };
    ctx.isf = { id: 'isf-1', data: isf };
    const out = runRules(ctx);
    expect(out.ran).toEqual(['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X11', 'X12', 'U1', 'T10', 'T11']);
    expect(out.findings).toEqual([]);

    ctx.isf.data = { ...isf, countryOfOrigin: 'VN', htsCode: '950490' };
    delete ctx.invoice!.data.invoiceDate;
    expect(ruleIds(ctx)).toEqual(['X11', 'X11', 'U1']);
  });
});
