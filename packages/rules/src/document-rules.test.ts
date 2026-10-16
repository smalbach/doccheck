import { describe, expect, it } from 'vitest';
import {
  sampleAirWaybill, sampleArrivalNotice, sampleBillOfLading, sampleCertificateOfOrigin, sampleCusmaCertification, sampleDangerousGoods, sampleInvoice,
  samplePackingList, sampleWoodPackaging,
} from '@doccheck/schemas';
import { runRules } from './engine';
import { awbCheckDigit, isValidAwbNumber } from './rules/t1-awb-check-digit';
import type { ShipmentContext } from './types';

const sea = (): ShipmentContext =>
  structuredClone({
    shipmentId: 'shp-1',
    destination: 'CA',
    invoice: { id: 'inv-1', data: sampleInvoice },
    packingList: { id: 'pl-1', data: samplePackingList },
    billOfLading: { id: 'bl-1', data: sampleBillOfLading },
  });

/** The sample shipment flown: an air waybill instead of the bill of lading. */
const air = (): ShipmentContext => {
  const ctx = sea();
  delete ctx.billOfLading;
  ctx.airWaybill = { id: 'awb-1', data: structuredClone(sampleAirWaybill) };
  ctx.invoice!.data.transport = { mode: 'AIR' };
  ctx.invoice!.data.shipmentDate = '2026-10-05';
  return ctx;
};

// The fixtures' carrier SCAC is made up: the account knows it (rule X15).
const PARAMS = { knownScacs: ['EXLN'] };
const ids = (ctx: ShipmentContext) => runRules(ctx, PARAMS).findings.map((f) => f.ruleId);
const findings = (ctx: ShipmentContext, rule: string) => runRules(ctx, PARAMS).findings.filter((f) => f.ruleId === rule);

describe('engine with the other documents', () => {
  it('a clean sea shipment with every certificate finds nothing', () => {
    const ctx = sea();
    ctx.certificateOfOrigin = { id: 'coo-1', data: structuredClone(sampleCertificateOfOrigin) };
    ctx.arrivalNotice = { id: 'an-1', data: structuredClone(sampleArrivalNotice) };
    ctx.woodPackaging = { id: 'wp-1', data: structuredClone(sampleWoodPackaging) };
    const out = runRules(ctx, PARAMS);
    expect(out.findings).toEqual([]);
    expect(out.ran).toEqual(expect.arrayContaining(['T7', 'T8', 'T10', 'T11', 'T12']));
    expect(out.notApplicable).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T9', 'T13']);
  });

  it('an air shipment runs the air waybill rules, and the ocean rules do not apply instead of being skipped', () => {
    const out = runRules(air(), PARAMS);
    expect(out.findings).toEqual([]);
    expect(out.ran).toEqual(expect.arrayContaining(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']));
    expect(out.notApplicable).toEqual(expect.arrayContaining(['X1', 'X2', 'X3', 'X9', 'X10', 'X12']));
    expect(out.skipped).toEqual([]);
  });

  it('an optional rule without its documents is not applicable, not missing input', () => {
    const out = runRules(sea(), PARAMS);
    expect(out.skipped).toEqual([]);
    expect(out.notApplicable).toContain('T9');
  });
});

describe('T1 air waybill check digit', () => {
  it('computes the mod-7 check digit', () => {
    expect(awbCheckDigit('1234567')).toBe(5);
    expect(isValidAwbNumber('176-12345675')).toBe(true);
    expect(isValidAwbNumber('176 1234 5675')).toBe(true);
    expect(isValidAwbNumber('176-12345676')).toBe(false);
  });
  it('flags a mistyped master number, and a house number only when it is in the IATA format', () => {
    const ctx = air();
    ctx.airWaybill!.data.awbNumber = '176-12345676';
    expect(findings(ctx, 'T1')[0].evidence).toEqual([{ documentId: 'awb-1', field: 'awbNumber', value: '176-12345676' }]);
    ctx.airWaybill!.data = { ...ctx.airWaybill!.data, issuer: 'HAWB', awbNumber: 'SZXF0012345', masterAwbNumber: '176-12345675' };
    expect(ids(ctx)).not.toContain('T1');
    ctx.airWaybill!.data.masterAwbNumber = '176-12345670';
    expect(findings(ctx, 'T1').map((f) => f.evidence[0].field)).toEqual(['masterAwbNumber']);
  });
});

describe('T2-T3 air waybill pieces and weights', () => {
  it('T2 flags pieces that differ from the packing list', () => {
    const ctx = air();
    ctx.airWaybill!.data.pieces = 118;
    expect(findings(ctx, 'T2')[0].evidence.map((e) => e.field)).toEqual(['pieces', 'packageCount', 'totals.packageCount']);
  });
  it('T3 flags a gross weight outside tolerance and a chargeable weight below gross', () => {
    const ctx = air();
    ctx.airWaybill!.data.grossWeight = { kg: '1300', raw: { value: '1300', unit: 'KG' } };
    expect(findings(ctx, 'T3').map((f) => f.severity)).toEqual(['MEDIUM']);
    ctx.airWaybill!.data.chargeableWeight = { kg: '1000', raw: { value: '1000', unit: 'KG' } };
    expect(findings(ctx, 'T3').map((f) => f.severity)).toEqual(['MEDIUM', 'LOW']);
  });
});

describe('T4-T6 ocean rules on the air waybill', () => {
  it('T4 flags another consignee and cites the air waybill', () => {
    const ctx = air();
    ctx.airWaybill!.data.consignee = { ...ctx.airWaybill!.data.consignee, name: 'Northwind Imports Ltd.' };
    const [f] = findings(ctx, 'T4');
    expect(f.message).toContain('on the air waybill');
    expect(f.evidence.map((e) => [e.documentId, e.field])).toEqual([['inv-1', 'consignee.name'], ['awb-1', 'consignee.name']]);
  });
  it('T5 compares the invoice shipment date with the flight date', () => {
    const ctx = air();
    ctx.airWaybill!.data.flights = [{ flight: 'XA 821', date: '2026-10-20' }];
    const [f] = findings(ctx, 'T5');
    expect(f.message).toContain('the goods flew on 2026-10-20');
    expect(f.evidence[1]).toEqual({ documentId: 'awb-1', field: 'flights[0].date', value: '2026-10-20' });
  });
  it('T6 compares the terms of sale with the freight terms', () => {
    const ctx = air();
    ctx.airWaybill!.data.freightTerms = 'PREPAID';
    expect(findings(ctx, 'T6')[0].suggestedFix).toContain('air freight');
  });
});

describe('T7-T9 certificates of origin', () => {
  it('T7 flags an exporter and a consignee that are not the invoice parties', () => {
    const ctx = sea();
    ctx.certificateOfOrigin = { id: 'coo-1', data: { ...structuredClone(sampleCertificateOfOrigin), exporter: { name: 'Golden Bridge Trading', address: { lines: [] } } } };
    expect(findings(ctx, 'T7').map((f) => f.evidence[0].field)).toEqual(['exporter.name']);
    ctx.certificateOfOrigin.data.exporter = sampleInvoice.seller;
    ctx.certificateOfOrigin.data.consignee = { name: 'Other Buyer Corp', address: { lines: [] } };
    expect(findings(ctx, 'T7').map((f) => f.evidence[0].field)).toEqual(['consignee.name']);
  });
  it('T7 accepts names that differ only in case, punctuation or legal form', () => {
    const ctx = sea();
    ctx.cusmaCertification = { id: 'cus-1', data: { ...structuredClone(sampleCusmaCertification), exporter: { name: 'ACME TOYS CO LTD', address: { lines: [] } } } };
    expect(ids(ctx)).not.toContain('T7');
  });
  it('T8 flags an invoice HS subheading the certificate does not list, and another origin', () => {
    const ctx = sea();
    ctx.certificateOfOrigin = { id: 'coo-1', data: structuredClone(sampleCertificateOfOrigin) };
    ctx.certificateOfOrigin.data.goods[0].hsCode = '9502.10';
    expect(findings(ctx, 'T8')[0].evidence.map((e) => e.field)).toEqual(['lines[0].hsCode', 'goods[0].hsCode']);
    ctx.certificateOfOrigin.data.goods[0].hsCode = '9503.00';
    ctx.certificateOfOrigin.data.countryOfOrigin = 'VN';
    const [f] = findings(ctx, 'T8');
    expect(f.severity).toBe('HIGH');
    expect(f.evidence.map((e) => e.field)).toEqual(['countryOfOrigin', 'lines[0].countryOfOrigin']);
  });
  it('T9 names each missing CUSMA element', () => {
    const ctx = sea();
    ctx.cusmaCertification = { id: 'cus-1', data: { certifierRole: 'IMPORTER', goods: [{ description: 'Plush teddy bear', hsCode: '9503' }] } };
    const found = findings(ctx, 'T9');
    expect(found.map((f) => f.message.match(/element (\d)/)![1])).toEqual(['2', '3', '4', '6', '7', '9']);
    expect(runRules({ ...sea(), cusmaCertification: { id: 'cus-2', data: structuredClone(sampleCusmaCertification) } }, PARAMS).findings).toEqual([]);
  });
  it('T9 checks the blanket period', () => {
    const ctx = sea();
    ctx.cusmaCertification = { id: 'cus-1', data: { ...structuredClone(sampleCusmaCertification), blanketPeriod: { from: '2026-01-01', to: '2027-06-30' } } };
    expect(findings(ctx, 'T9')[0].message).toContain('longer than 12 months');
  });
});

describe('T10 dangerous goods', () => {
  it('flags hazardous goods without a declaration, from a UN number, a word or an HS heading', () => {
    const ctx = sea();
    ctx.invoice!.data.lines[0].description = 'Power bank 20000 mAh, lithium-ion';
    expect(findings(ctx, 'T10')[0].evidence[0]).toMatchObject({ documentId: 'inv-1', field: 'lines[0].description' });
    ctx.invoice!.data.lines[0].description = 'Power bank';
    ctx.invoice!.data.lines[0].hsCode = '8507.60';
    expect(findings(ctx, 'T10')[0].evidence[0]).toMatchObject({ field: 'lines[0].hsCode', value: '8507.60' });
    ctx.invoice!.data.lines[0].hsCode = '9503.00';
    ctx.billOfLading!.data.cargoDescription = '120 CTNS TOYS WITH BATTERIES UN 3481';
    expect(findings(ctx, 'T10')[0].message).toContain('UN3481');
  });
  it('does not flag goods described as non-hazardous', () => {
    const ctx = sea();
    ctx.billOfLading!.data.cargoDescription = '120 CTNS PLUSH TOYS, NON-HAZARDOUS';
    expect(ids(ctx)).not.toContain('T10');
  });
  it('with a declaration, flags a UN number it does not list', () => {
    const ctx = sea();
    ctx.dangerousGoods = { id: 'dg-1', data: structuredClone(sampleDangerousGoods) };
    ctx.billOfLading!.data.cargoDescription = '120 CTNS TOYS WITH BATTERIES UN3481';
    expect(ids(ctx)).not.toContain('T10');
    ctx.billOfLading!.data.cargoDescription = '120 CTNS LITHIUM BATTERIES UN3480';
    expect(findings(ctx, 'T10')[0].message).toMatch(/^UN3480 is quoted/);
  });
});

describe('T11 wood packaging', () => {
  it('flags wooden pallets with no ISPM 15 evidence, and not pallets of unstated material', () => {
    const ctx = sea();
    ctx.billOfLading!.data.cargoDescription = 'SAID TO CONTAIN 10 PLTS PLUSH TOYS';
    expect(ids(ctx)).not.toContain('T11');
    ctx.billOfLading!.data.cargoDescription = 'SAID TO CONTAIN 10 WOODEN PALLETS PLUSH TOYS';
    expect(findings(ctx, 'T11')[0].evidence).toEqual([{ documentId: 'bl-1', field: 'cargoDescription', value: 'SAID TO CONTAIN 10 WOODEN PALLETS PLUSH TOYS' }]);
  });
  it('accepts a certificate or an ISPM 15 statement, and flags a no-wood declaration that contradicts the BL', () => {
    const ctx = sea();
    ctx.billOfLading!.data.cargoDescription = '10 WOODEN PALLETS PLUSH TOYS';
    ctx.billOfLading!.data.marksAndNumbers = 'PALLETS ISPM 15 HT';
    expect(ids(ctx)).not.toContain('T11');
    delete ctx.billOfLading!.data.marksAndNumbers;
    ctx.woodPackaging = { id: 'wp-1', data: { kind: 'NO_WOOD_DECLARATION' } };
    expect(findings(ctx, 'T11')[0].message).toContain('no wood packaging');
  });
});

describe('T12 arrival notice', () => {
  it('flags another bill, other containers, packages and weight', () => {
    const ctx = sea();
    ctx.arrivalNotice = { id: 'an-1', data: { ...structuredClone(sampleArrivalNotice), transportDocumentNumber: 'HBLSZ999999' } };
    expect(findings(ctx, 'T12').map((f) => f.severity)).toEqual(['HIGH']);
    ctx.arrivalNotice.data = { ...structuredClone(sampleArrivalNotice), containers: [{ number: 'TGHU1234567' }], packages: 110, grossWeight: { kg: '1400', raw: { value: '1400', unit: 'KG' } } };
    expect(findings(ctx, 'T12').map((f) => f.evidence[0].field)).toEqual(['containers[0].number', 'packages', 'grossWeight.kg']);
  });
  it('matches an air waybill number written without its dash', () => {
    const ctx = air();
    ctx.arrivalNotice = { id: 'an-1', data: { ...structuredClone(sampleArrivalNotice), mode: 'AIR', transportDocumentNumber: '176 12345675', containers: undefined } };
    expect(ids(ctx)).not.toContain('T12');
  });
});

describe('T13 signature and stamp', () => {
  it('is not applicable until the paper was looked at', () => {
    expect(runRules(sea(), PARAMS).notApplicable).toContain('T13');
  });
  it('reports an original BL without signature or stamp, as information, citing the signature block', () => {
    const ctx = sea();
    ctx.attestations = { 'bl-1': { signature: false, stamp: false, page: 1, bbox: [300, 700, 560, 760], signatureBlock: true } };
    const [f] = findings(ctx, 'T13');
    expect(f.severity).toBe('INFO');
    expect(f.evidence[0].source).toEqual({ documentId: 'bl-1', page: 1, bbox: [300, 700, 560, 760], rawText: 'Signature block' });
    ctx.billOfLading!.data.blType = { issuer: 'HBL', form: 'SEAWAY' };
    expect(ids(ctx)).not.toContain('T13');
    ctx.billOfLading!.data.blType = { issuer: 'HBL', form: 'ORIGINAL' };
    ctx.attestations = { 'bl-1': { signature: false, stamp: false, signatureBlock: false } };
    expect(runRules(ctx, PARAMS).notApplicable).toContain('T13');
  });
  it('asks for both signature and stamp on a chamber certificate', () => {
    const ctx = sea();
    ctx.certificateOfOrigin = { id: 'coo-1', data: structuredClone(sampleCertificateOfOrigin) };
    ctx.attestations = { 'coo-1': { signature: true, stamp: false } };
    expect(findings(ctx, 'T13')[0].message).toContain('No stamp');
    ctx.attestations = { 'coo-1': { signature: true, stamp: true } };
    expect(ids(ctx)).not.toContain('T13');
  });
});

describe('T8 without an origin', () => {
  it('flags a certificate of origin that does not state the country', () => {
    const ctx = sea();
    ctx.certificateOfOrigin = { id: 'coo-1', data: structuredClone(sampleCertificateOfOrigin) };
    delete ctx.certificateOfOrigin.data.countryOfOrigin;
    expect(findings(ctx, 'T8').map((f) => [f.severity, f.evidence[0].field])).toEqual([['HIGH', 'countryOfOrigin']]);
  });
});
