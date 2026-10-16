import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runRules, V1_RULE_IDS, type ShipmentContext } from '@doccheck/rules';
import { BillOfLading, CommercialInvoice, PackingList } from '@doccheck/schemas';
import { buildDataset, V1, V2 } from './dataset';
import type { SyntheticShipment } from './generate';
import { renderHtml } from './pdf';
import { isV2Template } from './render-v2';

const context = (s: SyntheticShipment): ShipmentContext => ({
  shipmentId: s.id,
  destination: s.destination,
  invoice: { id: 'invoice', data: s.documents.invoice },
  packingList: { id: 'packingList', data: s.documents.packingList },
  billOfLading: { id: 'billOfLading', data: s.documents.billOfLading },
  isf: s.documents.isf ? { id: 'isf', data: s.documents.isf } : undefined,
});

const v2 = buildDataset(V2);

describe('dataset v2', () => {
  it('has the planned size and is reproducible', () => {
    expect(v2).toHaveLength(2 * V2.perCountry);
    expect(v2.filter((e) => e.labels.length === 0)).toHaveLength(2 * V2.cleanPerCountry);
    expect(JSON.stringify(buildDataset(V2))).toBe(JSON.stringify(v2));
  });

  it('mixes new layouts, long tables and non-English names', () => {
    const newLayouts = v2.flatMap((e) => [e.shipment.render.invoiceTemplate, e.shipment.render.packingListTemplate, e.shipment.render.blTemplate]).filter(isV2Template);
    expect(newLayouts.length).toBeGreaterThan(v2.length * 0.6);
    expect(v2.filter((e) => e.shipment.documents.invoice.lines.length >= 12).length).toBeGreaterThan(10);
    expect(v2.filter((e) => /[^\x00-\x7f]/.test(e.shipment.documents.invoice.seller.name + e.shipment.documents.invoice.buyer.name)).length).toBeGreaterThan(15);
  });

  it('clean shipments match the schemas and pass every rule', () => {
    for (const { clean: s } of v2) {
      expect(CommercialInvoice.safeParse(s.documents.invoice).error).toBeUndefined();
      expect(PackingList.safeParse(s.documents.packingList).error).toBeUndefined();
      expect(BillOfLading.safeParse(s.documents.billOfLading).error).toBeUndefined();
      expect([s.id, runRules(context(s), {}, { only: V1_RULE_IDS }).findings.map((f) => f.ruleId)]).toEqual([s.id, []]);
    }
  });

  it('the rule engine flags exactly the rules each label expects', () => {
    for (const { shipment, labels } of v2) {
      const expected = new Set(labels.flatMap((l) => l.expectedRuleIds));
      const got = new Set(runRules(context(shipment), {}, { only: V1_RULE_IDS }).findings.map((f) => f.ruleId));
      expect([shipment.id, [...got].sort()]).toEqual([shipment.id, [...expected].sort()]);
    }
  });

  it('new layouts print the scored identifiers', () => {
    for (const { shipment } of v2) {
      const html = renderHtml(shipment);
      const { invoice, packingList, billOfLading } = shipment.documents;
      expect(html.invoice).toContain(invoice.invoiceNumber);
      invoice.lines.forEach((l) => expect(html.invoice).toContain(l.hsCode));
      expect(html['packing-list']).toContain(packingList.invoiceRef);
      expect(html['bill-of-lading']).toContain(billOfLading.blNumber);
      billOfLading.containers.forEach((c) => expect(html['bill-of-lading']).toContain(c.number));
    }
  });
});

describe('set v1 is unchanged', () => {
  // The cached model answers are keyed on the PDF text, so v1 must not move by a byte.
  const dir = resolve(__dirname, '../../../data/eval/v1');
  it.skipIf(!existsSync(dir))('truth files match the published set', () => {
    for (const { shipment } of buildDataset(V1)) {
      const { id, seed, destination, render, documents } = shipment;
      const published = readFileSync(resolve(dir, id, 'truth.json'), 'utf8');
      expect(JSON.stringify({ id, seed, destination, render, documents }, null, 2) + '\n').toBe(published);
    }
  });
});
