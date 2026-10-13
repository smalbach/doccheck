import { describe, expect, it } from 'vitest';
import { BillOfLading, CommercialInvoice, PackingList } from './index';
import { sampleBillOfLading, sampleInvoice, samplePackingList } from './fixtures';

describe('document schemas', () => {
  it('accepts the sample shipment', () => {
    expect(CommercialInvoice.safeParse(sampleInvoice).success).toBe(true);
    expect(PackingList.safeParse(samplePackingList).success).toBe(true);
    expect(BillOfLading.safeParse(sampleBillOfLading).success).toBe(true);
  });

  it('rejects money as a JavaScript number', () => {
    const bad = { ...sampleInvoice, invoiceTotal: { amount: 48600, currency: 'USD' } };
    expect(CommercialInvoice.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed container number', () => {
    const bad = { ...sampleBillOfLading, containers: [{ number: 'CSQ3054383' }] };
    expect(BillOfLading.safeParse(bad).success).toBe(false);
  });

  it('rejects a country name instead of an ISO code', () => {
    const bad = { ...sampleInvoice, lines: [{ ...sampleInvoice.lines[0], countryOfOrigin: 'China' }] };
    expect(CommercialInvoice.safeParse(bad).success).toBe(false);
  });
});
