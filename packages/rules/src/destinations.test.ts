import { describe, expect, it } from 'vitest';
import { sampleBillOfLading, sampleInvoice, samplePackingList, type Destination, type Party } from '@doccheck/schemas';
import { runRules } from './engine';
import { isValidEuEori, isValidGbEori } from './ids/eori';
import { rfcCheckDigit, rfcProblem } from './ids/rfc';
import { PROFILES } from './profiles';
import { ALL_RULES } from './registry';
import type { ShipmentContext } from './types';

const IMPORTER: Record<'MX' | 'EU' | 'GB', Party> = {
  MX: { name: 'Comercializadora del Bajío SA de CV', address: { lines: ['Av. Constituyentes 1000'], city: 'Querétaro', country: 'MX' }, taxId: 'MAG041126GT8' },
  EU: { name: 'Rheinwerk Handel GmbH', address: { lines: ['Hafenstrasse 12'], city: 'Duisburg', country: 'DE' }, taxId: 'DE123456789012345' },
  GB: { name: 'Thameside Retail Ltd', address: { lines: ['10 Dock Rd'], city: 'Tilbury', country: 'GB' }, taxId: 'GB123456789000' },
};

/** The sample shipment re-addressed to `destination`, with an importer that carries a valid number. */
const shipment = (destination: 'MX' | 'EU' | 'GB'): ShipmentContext => {
  const ctx = structuredClone({
    shipmentId: 'shp-1',
    destination: destination as Destination,
    invoice: { id: 'inv-1', data: sampleInvoice },
    packingList: { id: 'pl-1', data: samplePackingList },
    billOfLading: { id: 'bl-1', data: sampleBillOfLading },
  });
  const importer = structuredClone(IMPORTER[destination]);
  ctx.invoice.data.buyer = importer;
  ctx.invoice.data.consignee = structuredClone(importer);
  ctx.invoice.data.seller = { ...ctx.invoice.data.seller, taxId: '91440300MA5XXXXX1' };
  ctx.packingList.data.consignee = structuredClone(importer);
  ctx.billOfLading.data.consignee = structuredClone(importer);
  if (destination === 'MX') ctx.invoice.data.language = 'es';
  return ctx;
};

const findings = (ctx: ShipmentContext) => runRules(ctx).findings;
const ids = (ctx: ShipmentContext) => findings(ctx).map((f) => f.ruleId);

describe('profiles', () => {
  it('every profile names only registered rules, and every destination rule applies to its profile', () => {
    const registered = new Set(ALL_RULES.map((r) => r.definition.id));
    for (const p of Object.values(PROFILES)) {
      for (const id of p.rules) expect(registered.has(id), `${p.code} ${id}`).toBe(true);
    }
    for (const r of ALL_RULES) {
      if (r.definition.appliesTo === 'ALL') continue;
      for (const d of r.definition.appliesTo) expect(PROFILES[d].rules).toContain(r.definition.id);
    }
  });

  it.each(['MX', 'EU', 'GB'] as const)('%s: a clean shipment raises nothing', (d) => {
    const out = runRules(shipment(d));
    expect(out.findings).toEqual([]);
    expect(out.ran).toEqual(expect.arrayContaining(PROFILES[d].rules.filter((r) => r !== 'X11')));
  });
});

describe('RFC', () => {
  it('accepts real RFCs of companies and people, and the generic ones', () => {
    for (const rfc of ['SAT970701NN3', 'IMS421231I45', 'WMT970714R10', 'GODE561231GR8', 'XAXX010101000', 'XEXX010101000', 'gode-561231-gr8']) expect(rfcProblem(rfc), rfc).toBeNull();
  });
  it('computes the check digit, including 0 and A', () => {
    expect(rfcCheckDigit('SAT970701NN')).toBe('3');
    expect(rfcCheckDigit('WMT970714R1')).toBe('0');
    // A remainder of 1 gives 10, written "A".
    const a = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => `SA${c}970701NN`).find((s) => rfcCheckDigit(s) === 'A');
    expect(a).toBeDefined();
  });
  it('names what is wrong', () => {
    expect(rfcProblem('SAT970701NN4')).toBe('check_digit');
    expect(rfcProblem('SAT971301NN3')).toBe('date');
    expect(rfcProblem('SAT970230NN3')).toBe('date');
    expect(rfcProblem('S4T970701NN3')).toBe('format');
    expect(rfcProblem('123456789')).toBe('format');
  });
});

describe('EORI', () => {
  it('EU: member state prefix and up to 15 characters', () => {
    expect(isValidEuEori('DE123456789012345')).toBe(true);
    expect(isValidEuEori('FR 12345678900017')).toBe(true);
    expect(isValidEuEori('XI123456789000')).toBe(true);
    expect(isValidEuEori('GB123456789000')).toBe(false);
    expect(isValidEuEori('EL123456789')).toBe(false);
    expect(isValidEuEori('DE1234567890123456')).toBe(false);
  });
  it('GB: GB or XI and 12 digits', () => {
    expect(isValidGbEori('GB123456789000')).toBe(true);
    expect(isValidGbEori('GB 123 4567 89000')).toBe(true);
    expect(isValidGbEori('XI123456789000')).toBe(true);
    expect(isValidGbEori('GB123456789000123')).toBe(false);
    expect(isValidGbEori('GB123456789')).toBe(false);
    expect(isValidGbEori('DE123456789000')).toBe(false);
  });
});

describe('M1-M3 (Mexico)', () => {
  it('M1 reports one finding per missing field, citing the fracción', () => {
    const ctx = shipment('MX');
    delete ctx.invoice!.data.buyer.taxId;
    delete ctx.invoice!.data.consignee!.taxId;
    delete ctx.invoice!.data.invoiceDate;
    const m1 = findings(ctx).filter((f) => f.ruleId === 'M1');
    expect(m1.map((f) => f.evidence[0].field)).toEqual(['invoiceDate', 'buyer.taxId']);
    expect(m1[0].message).toMatch(/\(RGCE regla 3\.1\.8, fracción I\)\.$/);
    m1.shift();
    expect(m1[0].message).toMatch(/\(RGCE regla 1\.9\.19, fracción I, inciso d\)\.$/);
    expect(ids(ctx)).not.toContain('M2');
  });
  it('M2 flags a bad check digit and gives the expected one', () => {
    const ctx = shipment('MX');
    ctx.invoice!.data.buyer.taxId = 'MAG041126GT9';
    const [m2] = findings(ctx).filter((f) => f.ruleId === 'M2');
    expect(m2.message).toMatch(/check digit.*expected 8/);
    expect(m2.evidence).toEqual([{ documentId: 'inv-1', field: 'buyer.taxId', value: 'MAG041126GT9' }]);
  });
  it('M3 accepts Spanish, English and French, and asks for a translation otherwise', () => {
    const ctx = shipment('MX');
    for (const lang of ['es', 'en', 'fr']) {
      ctx.invoice!.data.language = lang;
      expect(ids(ctx)).not.toContain('M3');
    }
    ctx.invoice!.data.language = 'zh';
    const [m3] = findings(ctx).filter((f) => f.ruleId === 'M3');
    expect(m3.suggestedFix).toMatch(/Spanish translation/);
  });
});

describe('E1-E3 (European Union)', () => {
  it('E1 needs the Incoterm with its place and an importer EORI on the buyer or consignee', () => {
    const ctx = shipment('EU');
    ctx.invoice!.data.incoterm = { code: 'FOB', place: ' ' };
    delete ctx.invoice!.data.buyer.taxId;
    // The consignee still carries the importer's EORI.
    expect(findings(ctx).map((f) => f.evidence[0].field)).toEqual(['incoterm']);
    delete ctx.invoice!.data.consignee!.taxId;
    expect(findings(ctx).filter((f) => f.ruleId === 'E1').map((f) => f.evidence[0].field)).toEqual(['buyer.taxId', 'incoterm']);
  });
  it('E2 rejects a UK EORI on an EU import', () => {
    const ctx = shipment('EU');
    ctx.invoice!.data.buyer.taxId = 'GB123456789000';
    expect(ids(ctx)).toEqual(['E2']);
  });
  it('E3 wants six-digit HS codes and the consignee country for ICS2', () => {
    const ctx = shipment('EU');
    ctx.invoice!.data.lines[0].hsCode = '9503';
    delete ctx.billOfLading!.data.consignee.address.country;
    const e3 = findings(ctx).filter((f) => f.ruleId === 'E3');
    expect(e3.map((f) => f.evidence[0].field)).toEqual(['lines[0].hsCode', 'consignee.address.country']);
  });
  it('E3 takes the notify party of a to-order bill', () => {
    const ctx = shipment('EU');
    ctx.billOfLading!.data.consignee = { name: 'TO ORDER', address: { lines: [] } };
    ctx.billOfLading!.data.notifyParty = undefined;
    const e3 = findings(ctx).filter((f) => f.ruleId === 'E3');
    expect(e3.map((f) => f.evidence[0].field)).toEqual(['notifyParty.name']);
  });
});

describe('K1-K3 (United Kingdom)', () => {
  it('K1 reports the missing commodity code per line, citing its CDS data element', () => {
    const ctx = shipment('GB');
    delete ctx.invoice!.data.lines[0].hsCode;
    expect(findings(ctx).map((f) => [f.ruleId, f.evidence[0].field])).toEqual([['K1', 'lines[0].hsCode']]);
    expect(findings(ctx)[0].message).toMatch(/\(HMRC CDS DE 6\/14\)\.$/);
  });
  it('K2 rejects an EU EORI on a UK import', () => {
    const ctx = shipment('GB');
    ctx.invoice!.data.buyer.taxId = 'DE123456789012345';
    expect(ids(ctx)).toEqual(['K2']);
  });
  it('K3: EU-origin goods without a statement on origin are pointed out (LOW)', () => {
    const ctx = shipment('GB');
    ctx.invoice!.data.lines[0].countryOfOrigin = 'IT';
    const [k3] = findings(ctx);
    expect([k3.ruleId, k3.severity]).toEqual(['K3', 'LOW']);
  });
  it('K3 checks the wording and the REX number above EUR 6 000', () => {
    const ctx = shipment('GB');
    const inv = ctx.invoice!.data;
    inv.lines[0].countryOfOrigin = 'IT';
    inv.currency = 'EUR';
    inv.lines[0].unitPrice.currency = 'EUR';
    inv.lines[0].lineTotal.currency = 'EUR';
    inv.invoiceTotal.currency = 'EUR';
    inv.originStatement = 'The exporter of the products covered by this document (Exporter Reference No ITREX0123456789) declares that, except where otherwise clearly indicated, these products are of EU preferential origin.';
    expect(ids(ctx)).toEqual([]);
    inv.originStatement = 'The exporter of the products covered by this document declares that these products are of EU preferential origin.';
    expect(findings(ctx).map((f) => f.message)).toEqual([expect.stringMatching(/REX number/)]);
    inv.originStatement = 'Made in Italy.';
    expect(findings(ctx).map((f) => f.ruleId)).toEqual(['K3', 'K3']);
  });
  it('K3 ignores goods of non-EU origin', () => {
    expect(ids(shipment('GB'))).toEqual([]);
  });
});
