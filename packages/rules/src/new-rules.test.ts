import { describe, expect, it } from 'vitest';
import { sampleBillOfLading, sampleInvoice, samplePackingList, type Isf } from '@doccheck/schemas';
import { runRules } from './engine';
import { compactRuleConfig, RuleConfigSchema } from './rule-config';
import {
  canonicalUnit,
  containerTypeOf,
  importerNumberKind,
  isKnownLocode,
  isValidImo,
  luhnValid,
  parseBusinessNumber,
  unitRatio,
} from './reference';
import { mad, median, productKey } from './rules/x23-price-history';
import { V1_RULE_IDS } from './registry';
import type { PricePoint, RuleConfig, ShipmentContext } from './types';
import { toFixed } from './decimal';

const PARAMS = { knownScacs: ['EXLN'] };

const isf = (): Isf => ({
  seller: sampleInvoice.seller,
  buyer: sampleInvoice.buyer,
  importerOfRecordNumber: '12-345678900',
  consigneeNumber: '12-345678900',
  manufacturer: sampleInvoice.seller,
  shipToParty: sampleInvoice.buyer,
  countryOfOrigin: 'CN',
  htsCode: '950300',
  containerStuffingLocation: sampleInvoice.seller.address,
  consolidator: sampleInvoice.seller,
});

const ca = (): ShipmentContext =>
  structuredClone({
    shipmentId: 'shp-1',
    destination: 'CA' as const,
    invoice: { id: 'inv-1', data: sampleInvoice },
    packingList: { id: 'pl-1', data: samplePackingList },
    billOfLading: { id: 'bl-1', data: sampleBillOfLading },
  });

const us = (): ShipmentContext => {
  const ctx = ca();
  ctx.destination = 'US';
  const lax = { name: 'Los Angeles', unLocode: 'USLAX', country: 'US' };
  ctx.invoice!.data.portOfEntry = lax;
  ctx.billOfLading!.data.portOfDischarge = lax;
  ctx.billOfLading!.data.placeOfDelivery = lax;
  ctx.isf = { id: 'isf-1', data: isf() };
  return ctx;
};

const findings = (ctx: ShipmentContext, rule: string, config?: RuleConfig) => runRules(ctx, PARAMS, { config }).findings.filter((f) => f.ruleId === rule);
const all = (ctx: ShipmentContext) => runRules(ctx, PARAMS).findings.map((f) => f.ruleId);

describe('reference data', () => {
  it('knows UN/LOCODEs from the bundled UNECE list, aligned on 3 letters', () => {
    expect(isKnownLocode('CNYTN')).toBe(true);
    expect(isKnownLocode('CN YTN')).toBe(true);
    expect(isKnownLocode('CAVAN')).toBe(true);
    expect(isKnownLocode('CNXXQ')).toBe(false);
    expect(isKnownLocode('ZZAAA')).toBe(false);
  });
  it('checks IMO numbers', () => {
    expect(isValidImo('9074729')).toBe(true);
    expect(isValidImo('IMO 9321483')).toBe(true);
    expect(isValidImo('9074728')).toBe(false);
    expect(isValidImo('907472')).toBe(false);
  });
  it('checks Business Numbers and importer numbers', () => {
    expect(luhnValid('123456782')).toBe(true);
    expect(luhnValid('812345678')).toBe(false);
    expect(parseBusinessNumber('123456782 RM 0001')).toEqual({ bn9: '123456782', program: 'RM', reference: '0001' });
    expect(parseBusinessNumber('123456782')).toEqual({ bn9: '123456782' });
    expect(parseBusinessNumber('DE812345678')).toBeNull();
    expect(importerNumberKind('12-3456789')).toBe('EIN');
    expect(importerNumberKind('12-345678900')).toBe('EIN_SUFFIX');
    expect(importerNumberKind('261234-56789')).toBe('CBP');
    expect(importerNumberKind('123-45-6789')).toBe('SSN');
    expect(importerNumberKind('1234-5678')).toBeNull();
  });
  it('reads container types as printed', () => {
    expect(containerTypeOf("40'HC")?.type).toBe('40HC');
    expect(containerTypeOf('40HQ')?.type).toBe('40HC');
    expect(containerTypeOf('45G1')?.type).toBe('40HC');
    expect(containerTypeOf('20DV')?.type).toBe('20GP');
    expect(containerTypeOf('40 REEFER')?.type).toBe('40RF');
    expect(containerTypeOf('45HC')?.type).toBe('45HC');
    expect(containerTypeOf('FLAT')).toBeNull();
  });
  it('converts units exactly', () => {
    expect(canonicalUnit('pcs.')).toBe('PCS');
    expect(canonicalUnit('Each')).toBe('PCS');
    expect(unitRatio('DZ', 'PCS')).toEqual([toFixed('12'), toFixed('1')]);
    expect(unitRatio('SET', 'PCS')).toBeNull();
    expect(unitRatio('KG', 'M')).toBeNull();
  });
  it('computes median and MAD in fixed point', () => {
    const v = ['8.00', '8.10', '8.20', '8.10', '50.00'].map(toFixed);
    expect(median(v)).toBe(toFixed('8.10'));
    expect(mad(v)).toBe(toFixed('0.10'));
    expect(median(['1', '2'].map(toFixed))).toBe(toFixed('1.5'));
    expect(productKey({ sku: 'tb-200', description: 'x' })).toBe('sku:TB-200');
    expect(productKey({ description: 'Plush Teddy Bear, 30 cm' })).toBe('desc:PLUSH TEDDY BEAR 30 CM');
  });
});

describe('rules added after v1', () => {
  it('raise nothing on the clean fixture, CA and US', () => {
    expect(all(ca())).toEqual([]);
    expect(all({ ...us(), asOf: '2026-10-16' })).toEqual([]);
  });

  it('X13: flags an unknown UN/LOCODE and a code from another country', () => {
    const ctx = ca();
    ctx.billOfLading!.data.portOfLoading = { name: 'Yantian', unLocode: 'CNYTX', country: 'CN' };
    ctx.invoice!.data.transport!.placeOfShipment = { name: 'Yantian', unLocode: 'CNYTX', country: 'CN' };
    const x13 = findings(ctx, 'X13');
    expect(x13.map((f) => f.evidence[0].field)).toEqual(['transport.placeOfShipment.unLocode', 'portOfLoading.unLocode']);
    ctx.billOfLading!.data.portOfLoading = { name: 'Yantian', unLocode: 'CNYTN', country: 'HK' };
    ctx.invoice!.data.transport!.placeOfShipment = { name: 'Yantian', unLocode: 'CNYTN', country: 'CN' };
    expect(findings(ctx, 'X13').map((f) => f.severity)).toEqual(['LOW']);
  });

  it('X14: flags ports that differ between documents, by code or name', () => {
    const ctx = ca();
    ctx.invoice!.data.transport!.placeOfShipment = { name: 'Shekou', unLocode: 'CNSHK', country: 'CN' };
    expect(findings(ctx, 'X14')[0].message).toContain('Place of loading differs');
    ctx.invoice!.data.transport!.placeOfShipment = { name: 'Yantian' };
    ctx.billOfLading!.data.portOfLoading = { name: 'YANTIAN' };
    expect(findings(ctx, 'X14')).toEqual([]);
    const u = us();
    u.isf!.data.portOfDischarge = { name: 'Long Beach', unLocode: 'USLGB' };
    expect(findings(u, 'X14').map((f) => f.evidence.map((e) => e.documentId))).toEqual([['isf-1', 'bl-1']]);
  });

  it('X15: checks the IMO check digit, voyage and SCAC', () => {
    const ctx = ca();
    ctx.billOfLading!.data.vessel = 'MERIDIAN STAR';
    ctx.billOfLading!.data.vesselImo = '9074728';
    const x15 = findings(ctx, 'X15');
    expect(x15.map((f) => f.evidence[0].field)).toEqual(['vesselImo', 'voyage']);
    ctx.billOfLading!.data.vesselImo = '9074729';
    ctx.billOfLading!.data.voyage = '012E';
    expect(findings(ctx, 'X15')).toEqual([]);
    ctx.billOfLading!.data.carrier = { name: 'Example', scac: 'EX1N' };
    expect(findings(ctx, 'X15')[0].severity).toBe('MEDIUM');
    ctx.billOfLading!.data.carrier = { name: 'Maersk', scac: 'MAEU' };
    expect(findings(ctx, 'X15')).toEqual([]);
    ctx.billOfLading!.data.carrier = { name: 'Unknown', scac: 'QQQQ' };
    expect(findings(ctx, 'X15')[0].severity).toBe('LOW');
    expect(findings(ctx, 'X15', { params: { knownScacs: ['qqqq'] } })).toEqual([]);
  });

  it('X16: flags impossible dates, only against the run date it is given', () => {
    const ctx = ca();
    ctx.invoice!.data.invoiceDate = '2026-11-01';
    expect(findings(ctx, 'X16')).toEqual([]);
    ctx.asOf = '2026-10-16';
    expect(findings(ctx, 'X16')[0].message).toContain('after today (2026-10-16)');
    ctx.invoice!.data.invoiceDate = '2026-10-01';
    ctx.billOfLading!.data.shippedOnBoardDate = '2026-10-06';
    ctx.billOfLading!.data.estimatedArrivalDate = '2026-10-05';
    expect(findings(ctx, 'X16').map((f) => f.evidence.map((e) => e.field))).toEqual([['shippedOnBoardDate', 'estimatedArrivalDate']]);
  });

  it('X17: flags an invoice number already used for the same seller in another shipment', () => {
    const ctx = ca();
    const prior = { shipmentId: 'shp-0', shipmentReference: 'PO-4411 first', documentId: 'doc-0', invoiceNumber: 'inv 2026 0412', sellerName: 'ACME TOYS CO LTD' };
    ctx.account = { invoices: [prior] };
    const x17 = findings(ctx, 'X17');
    expect(x17[0].message).toContain('already used in shipment PO-4411 first');
    expect(x17[0].evidence.map((e) => e.documentId)).toEqual(['inv-1', 'doc-0']);
    ctx.account = { invoices: [{ ...prior, sellerName: 'Other Seller' }] };
    expect(findings(ctx, 'X17')).toEqual([]);
    ctx.account = { invoices: [{ ...prior, shipmentId: 'shp-1' }] };
    expect(findings(ctx, 'X17')).toEqual([]);
  });

  it('X18: converts units per SKU and flags what does not add up or convert', () => {
    const ctx = ca();
    ctx.packingList!.data.packages[0].contents[0].quantity = { value: '500', unit: 'DZ' };
    expect(findings(ctx, 'X18')).toEqual([]); // 500 dozen = 6000 pieces
    ctx.packingList!.data.packages[0].contents[0].quantity = { value: '490', unit: 'DZ' };
    const x18 = findings(ctx, 'X18');
    expect(x18[0].severity).toBe('HIGH');
    expect(x18[0].message).toContain('6000 pieces on the invoice, 5880 pieces on the packing list');
    ctx.packingList!.data.packages[0].contents[0].quantity = { value: '1000', unit: 'SET' };
    expect(findings(ctx, 'X18')[0].message).toContain('do not convert');
    ctx.packingList!.data.packages[0].contents[0].quantity = { value: '5999', unit: 'EA' };
    expect(findings(ctx, 'X18')).toHaveLength(1);
  });

  it('X19: flags cargo that does not fit the declared containers', () => {
    const ctx = ca();
    ctx.billOfLading!.data.containers[0].type = '20GP';
    ctx.packingList!.data.totals.volumeM3 = '40.00';
    expect(findings(ctx, 'X19')[0].message).toContain('hold at most 33.2 m3');
    ctx.packingList!.data.totals.volumeM3 = '11.52';
    ctx.billOfLading!.data.containers[0].grossWeight = { kg: '29000', raw: { value: '29000', unit: 'KG' } };
    expect(findings(ctx, 'X19').map((f) => f.severity)).toEqual(['HIGH']);
  });

  it('X20: compares the VGM with cargo weight plus tare', () => {
    const ctx = ca();
    const c = ctx.billOfLading!.data.containers[0];
    c.vgm = { kg: '5190', raw: { value: '5190', unit: 'KG' } }; // 1250 + typical 40HC tare 3940
    expect(findings(ctx, 'X20')).toEqual([]);
    c.vgm = { kg: '7000', raw: { value: '7000', unit: 'KG' } };
    expect(findings(ctx, 'X20')).toHaveLength(1);
    expect(findings(ctx, 'X20', { params: { vgmTolerance: 0.5 } })).toEqual([]);
    c.vgm = { kg: '1000', raw: { value: '1000', unit: 'KG' } };
    expect(findings(ctx, 'X20')[0].severity).toBe('HIGH');
  });

  it('X21: checks to-order and waybill consistency', () => {
    const ctx = ca();
    ctx.billOfLading!.data.consignee = { name: 'TO ORDER OF BANK OF EXAMPLE', address: { lines: [], country: 'CA' } };
    expect(findings(ctx, 'X21').map((f) => f.evidence[1].field)).toEqual(['numberOfOriginals', 'notifyParty']);
    ctx.billOfLading!.data.numberOfOriginals = 3;
    ctx.billOfLading!.data.notifyParty = sampleInvoice.buyer;
    expect(findings(ctx, 'X21')).toEqual([]);
    ctx.billOfLading!.data.blType = { issuer: 'HBL', form: 'SEAWAY' };
    expect(findings(ctx, 'X21').map((f) => f.severity)).toEqual(['HIGH', 'LOW']);
  });

  it('X22: checks invoice charges against the Incoterm', () => {
    const ctx = ca();
    ctx.invoice!.data.charges = { freight: { amount: '900.00', currency: 'USD' } };
    expect(findings(ctx, 'X22')[0].severity).toBe('LOW'); // FOB with freight
    ctx.invoice!.data.incoterm = { code: 'EXW', place: 'Shenzhen' };
    expect(findings(ctx, 'X22')[0].severity).toBe('MEDIUM');
    ctx.invoice!.data.incoterm = { code: 'CIF', place: 'Vancouver' };
    expect(findings(ctx, 'X22')[0].message).toContain('no insurance');
    ctx.invoice!.data.charges.insurance = { amount: '60.00', currency: 'USD' };
    expect(findings(ctx, 'X22')).toEqual([]);
    ctx.invoice!.data.incoterm = { code: 'CFR', place: 'Vancouver' };
    expect(findings(ctx, 'X22')[0].message).toContain('insurance is the buyer');
  });

  it('X23: flags a price far below the account median, citing the series', () => {
    const ctx = ca();
    const point = (unitPrice: string, i: number): PricePoint => ({ shipmentId: `old-${i}`, documentId: `doc-${i}`, line: 0, date: `2026-0${i + 1}-01`, unitPrice, currency: 'USD', unit: 'PCS' });
    const prices = ['8.00', '8.20', '8.10', '7.90', '8.30', '8.15'].map(point);
    ctx.account = { prices: { 'sku:TB-200': prices } };
    expect(findings(ctx, 'X23')).toEqual([]);
    ctx.invoice!.data.lines[0].unitPrice.amount = '4.10';
    const [f] = findings(ctx, 'X23');
    expect(f.message).toContain('below the median of 8.13 over 6 past purchases');
    expect(f.evidence).toHaveLength(7);
    expect(f.evidence[1]).toEqual({ documentId: 'doc-5', field: 'lines[0].unitPrice.amount', value: '8.15' });
    // Too little history, another currency or unit: nothing to compare.
    ctx.account = { prices: { 'sku:TB-200': prices.slice(0, 4) } };
    expect(findings(ctx, 'X23')).toEqual([]);
    ctx.account = { prices: { 'sku:TB-200': prices.map((p) => ({ ...p, currency: 'EUR' })) } };
    expect(findings(ctx, 'X23')).toEqual([]);
    ctx.account = { prices: { 'sku:TB-200': prices } };
    expect(findings(ctx, 'X23', { params: { priceDeviation: 0.6 } })).toEqual([]);
  });

  it('X24: matches the invoice and packing list against the imported PO', () => {
    const ctx = ca();
    const po = { id: 'po-1', poNumber: 'PO-4411', currency: 'USD', lines: [{ sku: 'TB-200', quantity: '6000', unit: 'PCS', unitPrice: '8.10' }] };
    expect(findings(ctx, 'X24')).toEqual([]); // no POs imported
    ctx.account = { purchaseOrders: [po] };
    expect(findings(ctx, 'X24')).toEqual([]);
    ctx.account = { purchaseOrders: [{ ...po, lines: [{ ...po.lines[0], quantity: '5000', unitPrice: '7.50' }] }] };
    const x24 = findings(ctx, 'X24');
    expect(x24.map((f) => f.evidence[1].field)).toEqual(['lines[0].quantity', 'lines[0].unitPrice', 'lines[0].quantity']);
    expect(x24[0].evidence[1].documentId).toBe('po:po-1');
    expect(findings(ctx, 'X24', { params: { poQuantityTolerance: 0.25, poPriceTolerance: 0.1 } })).toEqual([]);
    ctx.invoice!.data.poNumber = 'PO-9999';
    expect(findings(ctx, 'X24')[0].message).toContain('not among');
    // The API loads only the order the invoice names, and says how many the account has.
    ctx.account = { purchaseOrders: [], purchaseOrderCount: 12 };
    expect(findings(ctx, 'X24')[0].message).toContain('not among');
    delete ctx.invoice!.data.poNumber;
    expect(findings(ctx, 'X24')[0].severity).toBe('LOW');
  });

  it('C3: checks the importer Business Number and its RM account', () => {
    const ctx = ca();
    const set = (taxId: string) => {
      ctx.invoice!.data.consignee = { ...sampleInvoice.buyer, taxId };
      ctx.invoice!.data.buyer = { ...sampleInvoice.buyer, taxId };
    };
    set('123456782RM0001');
    expect(findings(ctx, 'C3')).toEqual([]);
    set('123456789RM0001');
    expect(findings(ctx, 'C3')[0].message).toContain('check digit');
    set('123456782RT0001');
    expect(findings(ctx, 'C3')[0].message).toContain('program account RT');
    set('123456782');
    expect(findings(ctx, 'C3')[0].severity).toBe('LOW');
    set('DE812345678');
    expect(findings(ctx, 'C3')).toEqual([]);
  });

  it('U2: flags missing or placeholder ISF elements and a filing against another bill', () => {
    const ctx = us();
    ctx.isf!.data.consigneeNumber = 'N/A';
    ctx.isf!.data.htsCode = '9503';
    ctx.isf!.data.containerStuffingLocation = { lines: [] };
    expect(findings(ctx, 'U2').map((f) => f.evidence[0].field)).toEqual(['consigneeNumber', 'htsCode', 'containerStuffingLocation']);
    const clean = us();
    clean.isf!.data.blNumber = 'EXLNHBLSZ123456';
    expect(findings(clean, 'U2')).toEqual([]);
    clean.isf!.data.blNumber = 'HBLSZ999999';
    clean.isf!.data.carrierElements = { vesselStowPlan: false };
    expect(findings(clean, 'U2').map((f) => f.evidence[0].field)).toEqual(['blNumber', 'carrierElements.vesselStowPlan']);
  });

  it('U3: flags an ISF filed less than 24 hours before loading', () => {
    const ctx = us();
    ctx.billOfLading!.data.shippedOnBoardDate = '2026-10-06';
    ctx.isf!.data.filedAt = '2026-10-05';
    expect(findings(ctx, 'U3')).toEqual([]); // the day before: maybe late, not surely
    ctx.isf!.data.filedAt = '2026-10-06';
    expect(findings(ctx, 'U3')[0].message).toContain('on the day of loading');
    ctx.isf!.data.filedAt = '2026-10-05T09:00:00Z';
    ctx.isf!.data.estimatedLoadingDate = '2026-10-06T08:00:00Z';
    expect(findings(ctx, 'U3')[0].message).toContain('only 23 hours before loading');
    expect(findings(ctx, 'U3')[0].message).toContain('USD 5,000');
    expect(findings(ctx, 'U3', { params: { isfLeadHours: 12 } })).toEqual([]);
  });

  it('U4: checks the importer of record number format', () => {
    const ctx = us();
    ctx.isf!.data.importerOfRecordNumber = '07-1234567';
    ctx.isf!.data.consigneeNumber = '12345';
    expect(findings(ctx, 'U4').map((f) => f.evidence[0].field)).toEqual(['importerOfRecordNumber', 'consigneeNumber']);
    ctx.isf!.data.importerOfRecordNumber = '261234-56789';
    ctx.isf!.data.consigneeNumber = 'P12345678';
    expect(findings(ctx, 'U4')).toEqual([]);
  });
});

describe('rule configuration', () => {
  it('turns rules off, overrides severity and is reported in the output', () => {
    const ctx = ca();
    ctx.billOfLading!.data.totalPackages = 121;
    const out = runRules(ctx, PARAMS, { config: { rules: { X2: { severity: 'LOW' }, X8: { enabled: false } } } });
    expect(out.findings.map((f) => [f.ruleId, f.severity])).toEqual([['X2', 'LOW']]);
    expect(out.disabled).toEqual(['X8']);
    expect(out.ran).not.toContain('X8');
    expect(runRules(ctx, PARAMS, { config: { rules: { X2: { enabled: false } } } }).findings).toEqual([]);
  });

  it('applies tolerances over the defaults', () => {
    const ctx = ca();
    ctx.billOfLading!.data.totalGrossWeight = { kg: '1300', raw: { value: '1300', unit: 'KG' } };
    expect(findings(ctx, 'X3')).toHaveLength(1);
    expect(findings(ctx, 'X3', { params: { grossWeightTolerance: 0.05 } })).toEqual([]);
    ctx.billOfLading!.data.totalGrossWeight = sampleBillOfLading.totalGrossWeight;
    ctx.billOfLading!.data.shippedOnBoardDate = '2026-10-15';
    expect(findings(ctx, 'X9')).toHaveLength(1);
    expect(findings(ctx, 'X9', { params: { shipmentDateDays: 14 } })).toEqual([]);
  });

  it('runs only the requested rules', () => {
    expect(runRules(ca(), PARAMS, { only: V1_RULE_IDS }).ran).toEqual(['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X10', 'X12', 'C1', 'C2']);
  });

  it('validates and compacts a stored config', () => {
    expect(RuleConfigSchema.safeParse({ rules: { X99: { enabled: false } } }).success).toBe(false);
    expect(RuleConfigSchema.safeParse({ params: { grossWeightTolerance: 2 } }).success).toBe(false);
    expect(RuleConfigSchema.safeParse({ params: { knownScacs: ['toolong'] } }).success).toBe(false);
    const parsed = RuleConfigSchema.parse({ rules: { X2: { enabled: true, severity: 'HIGH' }, X8: { enabled: false } }, params: { grossWeightTolerance: 0.005, vgmTolerance: 0.1, knownScacs: ['exln', 'EXLN'] } });
    expect(compactRuleConfig(parsed)).toEqual({ rules: { X8: { enabled: false } }, params: { vgmTolerance: 0.1, knownScacs: ['EXLN'] } });
    expect(compactRuleConfig({})).toEqual({});
  });
});
