import type { ShipmentContext } from '@doccheck/rules';
import { sampleBillOfLading, sampleInvoice, samplePackingList, type Isf } from '@doccheck/schemas';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { agencyRequirements } from './agencies';
import { loadTariffData, type TariffData } from './data';
import { runTariffRules } from './engine';
import { exportControlHints } from './export-control';
import { formatHs, hsFormat } from './hs-code';
import { codeStatus, tariffLines } from './lines';
import { quoteNote } from './notes';
import { TariffSearch, terms } from './search';

const DIR = resolve(__dirname, '../../../data/tariff');
let us: TariffData;
let ca: TariffData;

beforeAll(async () => {
  [us, ca] = await Promise.all([loadTariffData(DIR, 'US'), loadTariffData(DIR, 'CA')]);
});

const shipment = (destination: 'CA' | 'US', lines: { hsCode?: string; description?: string; sku?: string }[] = []): ShipmentContext => {
  const invoice = structuredClone(sampleInvoice);
  if (lines.length) {
    const base = invoice.lines[0];
    invoice.lines = lines.map((l, i) => ({ ...base, lineNo: i + 1, sku: l.sku ?? `SKU-${i + 1}`, description: l.description ?? base.description, hsCode: l.hsCode }));
  }
  return {
    shipmentId: 'shp-1',
    destination,
    invoice: { id: 'inv-1', data: invoice },
    packingList: { id: 'pl-1', data: structuredClone(samplePackingList) },
    billOfLading: { id: 'bl-1', data: structuredClone(sampleBillOfLading) },
  };
};

const isf = (htsCode: string): { id: string; data: Isf } => ({
  id: 'isf-1',
  data: {
    seller: sampleInvoice.seller,
    buyer: sampleInvoice.buyer,
    importerOfRecordNumber: '12-3456789',
    consigneeNumber: '12-3456789',
    manufacturer: sampleInvoice.seller,
    shipToParty: sampleInvoice.buyer,
    countryOfOrigin: 'CN',
    htsCode,
    containerStuffingLocation: sampleInvoice.seller.address,
    consolidator: sampleInvoice.seller,
  },
});

const ids = (ctx: ShipmentContext, data?: TariffData) => runTariffRules(ctx, { schedule: data?.schedule }).findings.map((f) => f.ruleId);

describe('HS code format', () => {
  it('accepts 6, 8 and 10 digits with or without dots', () => {
    expect(['9503.00', '950300', '9503.00.00', '9503.00.00.90', '9503 00 00 90'].map(hsFormat)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(hsFormat('9503')).toBe('heading-only');
    expect(['95030', '9503.00.9', 'HS 9503', ''].map(hsFormat)).toEqual(['malformed', 'malformed', 'malformed', 'malformed']);
    expect(formatHs('9503000090')).toBe('9503.00.00.90');
  });
});

describe('schedules', () => {
  it('load both schedules with the same HS subheadings', () => {
    const a = new Set(us.schedule.subheadings().map((s) => s.code));
    const b = new Set(ca.schedule.subheadings().map((s) => s.code));
    expect(a.size).toBeGreaterThan(5000);
    expect([...a].filter((c) => !b.has(c))).toEqual([]);
  });

  it('tells a valid code from a national code of another country and from a non-existent subheading', () => {
    expect(codeStatus('9503.00.00.71', us.schedule)).toBe('valid');
    expect(codeStatus('9503.00.90.51', ca.schedule)).toBe('valid');
    // A Canadian 10-digit code on a US invoice: the subheading is right, the national digits are not HTSUS.
    expect(codeStatus('9503.00.90.51', us.schedule)).toBe('national-unknown');
    expect(codeStatus('9503.00', us.schedule)).toBe('subheading');
    expect(codeStatus('9503.99', us.schedule)).toBe('unknown');
    expect(codeStatus('9503', ca.schedule)).toBe('heading');
    expect(codeStatus(undefined, ca.schedule)).toBe('missing');
    expect(codeStatus('9503.00', undefined)).toBe('not-checked');
  });

  it('describes a code by its path in the schedule', () => {
    expect(us.schedule.describe('950300')).toMatch(/toys/i);
    expect(ca.schedule.describe('9503009051')).toMatch(/Stuffed, plush-covered/);
  });
});

describe('notes', () => {
  it('finds the chapter note that sends goods to another heading, and quotes the item', () => {
    const notes = ca.notes.pointingTo('95', '8712');
    expect(notes.map((n) => n.ref)).toContain('Chapter 95, Note 1');
    expect(quoteNote(notes[0], { heading: '8712' })).toMatch(/^This Chapter does not cover: … \(o\) Children's bicycles \(heading 87\.12\)/);
    expect(us.notes.pointingTo('95', '8712').map((n) => n.ref)).toContain('Chapter 95, Note 1');
  });

  it('includes the section notes of the chapter', () => {
    expect(us.notes.governing('84').some((n) => n.ref.startsWith('Section XVI, Note'))).toBe(true);
    expect(ca.notes.governing('84').some((n) => n.ref.startsWith('Section XVI, Note'))).toBe(true);
  });
});

describe('keyword search', () => {
  it('folds plurals', () => {
    expect(terms('Toys, boxes and glasses')).toEqual(['toy', 'box', 'glass']);
  });

  it('ranks the right subheading near the top without embeddings', async () => {
    for (const data of [us, ca]) {
      const search = new TariffSearch(data.schedule);
      expect((await search.search('Plush teddy bears, stuffed toys', { limit: 5 })).map((c) => c.code)).toContain('950300');
      expect((await search.search('Ball bearings', { limit: 5 })).filter((c) => c.heading === '8482').length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('H1: format', () => {
  it('flags a heading-only code and a short ISF code', () => {
    const ctx = shipment('US', [{ hsCode: '9503' }]);
    ctx.isf = isf('9503');
    const out = runTariffRules(ctx, {}).findings.filter((f) => f.ruleId === 'H1');
    expect(out.map((f) => [f.severity, f.evidence[0].field])).toEqual([
      ['MEDIUM', 'lines[0].hsCode'],
      ['HIGH', 'htsCode'],
    ]);
  });

  it('accepts complete codes', () => {
    expect(ids(shipment('CA', [{ hsCode: '9503.00.90.51' }]))).not.toContain('H1');
  });
});

describe('H2: exists in the schedule', () => {
  it('flags a subheading that is not in the HS (HIGH) and foreign national digits (MEDIUM)', () => {
    const ctx = shipment('US', [{ hsCode: '9503.99' }, { hsCode: '9503.00.90.51' }, { hsCode: '9503.00.00.71' }]);
    const h2 = runTariffRules(ctx, { schedule: us.schedule }).findings.filter((f) => f.ruleId === 'H2');
    expect(h2.map((f) => [f.severity, f.evidence[0].value])).toEqual([
      ['HIGH', '9503.99'],
      ['MEDIUM', '9503.00.90.51'],
    ]);
    expect(h2[1].message).toMatch(/national/);
  });

  it('does not run without the schedule, and says so', () => {
    const out = runTariffRules(shipment('US', [{ hsCode: '9503.99' }]), {});
    expect(out.unavailable).toEqual(['H2']);
    expect(out.findings.map((f) => f.ruleId)).not.toContain('H2');
  });

  it('checks the ISF code', () => {
    const ctx = shipment('US');
    ctx.isf = isf('9999.99.0000');
    expect(runTariffRules(ctx, { schedule: us.schedule }).findings.filter((f) => f.ruleId === 'H2').map((f) => f.evidence[0].field)).toEqual(['htsCode']);
  });
});

describe('H3: consistent across documents', () => {
  it('flags one SKU under two subheadings', () => {
    const ctx = shipment('CA', [{ sku: 'A', hsCode: '9503.00' }, { sku: 'A', hsCode: '6109.10' }]);
    expect(ids(ctx, ca)).toContain('H3');
  });

  it('flags a packing list code that differs from the invoice', () => {
    const ctx = shipment('CA', [{ sku: 'TB-200', hsCode: '9503.00' }]);
    ctx.packingList!.data.packages[0].contents[0].hsCode = '6109.10';
    const h3 = runTariffRules(ctx, {}).findings.filter((f) => f.ruleId === 'H3');
    expect(h3).toHaveLength(1);
    expect(h3[0].evidence.map((e) => e.field)).toEqual(['packages[0].contents[0].hsCode', 'lines[0].hsCode']);
  });

  it('accepts the clean sample shipment', () => {
    expect(ids(shipment('CA'), ca).filter((r) => r.startsWith('H'))).toEqual([]);
  });
});

describe('P1: partner agencies', () => {
  it('maps food, toys and radios to the agency of each destination', () => {
    expect(agencyRequirements('0901110000', 'US').map((r) => r.id)).toEqual(['US-FDA-FOOD']);
    expect(agencyRequirements('0901110000', 'CA').map((r) => r.id)).toEqual(['CA-CFIA-FOOD']);
    expect(agencyRequirements('020130', 'US').map((r) => r.id)).toEqual(['US-FSIS-MEAT']);
    expect(agencyRequirements('950300', 'US').map((r) => r.id)).toEqual(['US-CPSC']);
    expect(agencyRequirements('851762', 'US').map((r) => r.id)).toEqual(['US-FCC']);
    expect(agencyRequirements('731815', 'CA').map((r) => r.id)).toEqual([]);
    expect(agencyRequirements('7208', 'CA').map((r) => r.id)).toEqual(['CA-GAC-STEEL']);
  });

  it('reports one finding per requirement, with every line it covers and its source', () => {
    const ctx = shipment('US', [{ hsCode: '0901.11', description: 'Green coffee beans' }, { hsCode: '1509.20', description: 'Extra virgin olive oil' }, { hsCode: '7318.15', description: 'Bolts' }]);
    const p1 = runTariffRules(ctx, { schedule: us.schedule }).findings.filter((f) => f.ruleId === 'P1');
    expect(p1).toHaveLength(1);
    expect(p1[0].severity).toBe('MEDIUM');
    expect(p1[0].evidence.map((e) => e.field)).toEqual(['lines[0].hsCode', 'lines[1].hsCode']);
    expect(p1[0].regulation?.url).toMatch(/ecfr\.gov.*part-1\/subpart-I/);
  });
});

describe('E1: export control hints', () => {
  it('needs a matching word for broad codes, and flags encryption anywhere', () => {
    expect(exportControlHints('847130', 'Laptop computer 14 inch')).toEqual([]);
    expect(exportControlHints('847150', 'Rack server, 2U, dual CPU').map((m) => m.hint.category)).toEqual([4]);
    expect(exportControlHints('854239', 'FPGA development board').map((m) => m.hint.category)).toEqual([3]);
    expect(exportControlHints('852351', 'USB drive with AES-256 hardware encryption').map((m) => m.hint.id)).toEqual(['EC-5-CRYPTO']);
    expect(exportControlHints('880621', 'Camera drone').map((m) => m.hint.category)).toEqual([9]);
  });

  it('is a LOW finding citing the destination list', () => {
    const f = runTariffRules(shipment('CA', [{ hsCode: '8542.39', description: 'FPGA development board' }]), {}).findings.find((x) => x.ruleId === 'E1');
    expect(f?.severity).toBe('LOW');
    expect(f?.regulation?.title).toMatch(/Export Control List/);
  });
});

describe('line reports', () => {
  it('give status, title and agency flags per invoice line', () => {
    const lines = tariffLines(shipment('US', [{ hsCode: '0901.11' }, {}]), us.schedule);
    expect(lines[0]).toMatchObject({ code: '090111', status: 'subheading', agencies: [{ id: 'US-FDA-FOOD' }] });
    expect(lines[0].title).toMatch(/Coffee/);
    expect(lines[1]).toMatchObject({ status: 'missing', agencies: [] });
  });
});
