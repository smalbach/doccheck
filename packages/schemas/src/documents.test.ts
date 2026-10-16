import { describe, expect, it } from 'vitest';
import {
  AirWaybill, ArrivalNotice, CertificateOfOrigin, CusmaCertification, DangerousGoodsDeclaration, SourceRef, WoodPackagingCertificate,
  sampleAirWaybill, sampleArrivalNotice, sampleCertificateOfOrigin, sampleCusmaCertification, sampleDangerousGoods, sampleWoodPackaging,
} from './index';

describe('schemas of the other freight documents', () => {
  it('accept the sample documents', () => {
    expect(AirWaybill.safeParse(sampleAirWaybill).success).toBe(true);
    expect(CertificateOfOrigin.safeParse(sampleCertificateOfOrigin).success).toBe(true);
    expect(CusmaCertification.safeParse(sampleCusmaCertification).success).toBe(true);
    expect(ArrivalNotice.safeParse(sampleArrivalNotice).success).toBe(true);
    expect(WoodPackagingCertificate.safeParse(sampleWoodPackaging).success).toBe(true);
    expect(DangerousGoodsDeclaration.safeParse(sampleDangerousGoods).success).toBe(true);
  });

  it('reject an airport name in place of an IATA code, and a malformed master waybill', () => {
    expect(AirWaybill.safeParse({ ...sampleAirWaybill, airportOfDeparture: { name: 'Shenzhen', iata: 'Shenzhen' } }).success).toBe(false);
    expect(AirWaybill.safeParse({ ...sampleAirWaybill, masterAwbNumber: '17612345675' }).success).toBe(false);
  });

  it('reject a UN number without its prefix and an unknown hazard class', () => {
    const item = sampleDangerousGoods.items[0];
    expect(DangerousGoodsDeclaration.safeParse({ ...sampleDangerousGoods, items: [{ ...item, unNumber: '3481' }] }).success).toBe(false);
    expect(DangerousGoodsDeclaration.safeParse({ ...sampleDangerousGoods, items: [{ ...item, hazardClass: '10' }] }).success).toBe(false);
  });

  it('parse a CUSMA certification that lacks elements, so the rule can name them', () => {
    expect(CusmaCertification.safeParse({ goods: [{ description: 'Steel brackets' }] }).success).toBe(true);
  });

  it('cite a spreadsheet cell', () => {
    expect(SourceRef.safeParse({ documentId: 'd', page: 1, rawText: '120', sheet: 'Invoice', cell: 'C12' }).success).toBe(true);
    expect(SourceRef.safeParse({ documentId: 'd', page: 1, rawText: '120', cell: 'c12' }).success).toBe(false);
  });
});
