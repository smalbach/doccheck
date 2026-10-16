import { describe, expect, it } from 'vitest';
import { runRules, V1_RULE_IDS, type ShipmentContext } from '@doccheck/rules';
import { BillOfLading, CommercialInvoice, Isf, PackingList } from '@doccheck/schemas';
import { buildDataset, V1 } from './dataset';
import { ERROR_KINDS, injectErrors } from './errors';
import { generateShipment, type SyntheticShipment } from './generate';
import { buildIsfDataset, renderIsf } from './isf';
import { renderHtml } from './pdf';
import { Rng } from './rng';

const context = (s: SyntheticShipment): ShipmentContext => ({
  shipmentId: s.id,
  destination: s.destination,
  invoice: { id: 'invoice', data: s.documents.invoice },
  packingList: { id: 'packingList', data: s.documents.packingList },
  billOfLading: { id: 'billOfLading', data: s.documents.billOfLading },
  isf: s.documents.isf ? { id: 'isf', data: s.documents.isf } : undefined,
});

const dataset = buildDataset();

/** "lines[*].countryOfOrigin" matches "lines[2].countryOfOrigin". */
const matchesField = (pattern: string, field: string) =>
  new RegExp(`^${pattern.replace(/[.*[\]]/g, '\\$&').replace('\\[\\*\\]', '\\[\\d+\\]')}$`).test(field);

describe('dataset v1', () => {
  it('has the planned size and mix', () => {
    expect(dataset).toHaveLength(2 * V1.perCountry);
    for (const country of ['CA', 'US']) {
      const rows = dataset.filter((e) => e.shipment.destination === country);
      expect(rows).toHaveLength(V1.perCountry);
      expect(rows.filter((e) => e.labels.length === 0)).toHaveLength(V1.cleanPerCountry);
    }
    expect(dataset.every((e) => e.labels.length <= 3)).toBe(true);
    expect(new Set(dataset.flatMap((e) => e.labels.map((l) => l.kind)))).toEqual(new Set(ERROR_KINDS));
  });

  it('is reproducible from its seed', () => {
    expect(JSON.stringify(buildDataset())).toBe(JSON.stringify(dataset));
  });

  it('only US shipments carry an ISF', () => {
    expect(dataset.every((e) => (e.shipment.destination === 'US') === !!e.shipment.documents.isf)).toBe(true);
  });
});

describe('clean shipments', () => {
  it.each(dataset.map((e) => [e.clean.id, e.clean] as const))('%s matches the schemas and passes every rule', (_, s) => {
    expect(CommercialInvoice.safeParse(s.documents.invoice).error).toBeUndefined();
    expect(PackingList.safeParse(s.documents.packingList).error).toBeUndefined();
    expect(BillOfLading.safeParse(s.documents.billOfLading).error).toBeUndefined();
    if (s.documents.isf) expect(Isf.safeParse(s.documents.isf).error).toBeUndefined();
    expect(runRules(context(s), {}, { only: V1_RULE_IDS }).findings).toEqual([]);
  });

  it('container totals add up to the BL totals', () => {
    for (const { clean } of dataset) {
      const bl = clean.documents.billOfLading;
      expect(bl.containers.reduce((acc, c) => acc + (c.packages ?? 0), 0)).toBe(bl.totalPackages);
      const kg = bl.containers.reduce((acc, c) => acc + Number(c.grossWeight!.kg), 0);
      expect(kg).toBeCloseTo(Number(bl.totalGrossWeight.kg), 2);
    }
  });
});

describe('injected errors', () => {
  it('the rule engine flags exactly the rules each label expects', () => {
    for (const { shipment, labels } of dataset) {
      const expected = new Set(labels.flatMap((l) => l.expectedRuleIds));
      const got = new Set(runRules(context(shipment), {}, { only: V1_RULE_IDS }).findings.map((f) => f.ruleId));
      expect([shipment.id, [...got].sort()]).toEqual([shipment.id, [...expected].sort()]);
    }
  });

  it('labels point at fields the rules cite as evidence', () => {
    for (const { shipment, labels } of dataset) {
      const findings = runRules(context(shipment), {}, { only: V1_RULE_IDS }).findings;
      for (const label of labels.filter((l) => l.expectedRuleIds.length > 0)) {
        const cited = findings
          .filter((f) => label.expectedRuleIds.includes(f.ruleId))
          .flatMap((f) => f.evidence)
          .some((ev) => ev.documentId === label.document && matchesField(label.field, ev.field));
        expect([shipment.id, label.kind, cited]).toEqual([shipment.id, label.kind, true]);
      }
    }
  });

  it('every kind can be injected alone', () => {
    const base = generateShipment('T-1', 'US', 7);
    for (const kind of ERROR_KINDS) {
      const { labels } = injectErrors(base, new Rng(1), 1, [kind]);
      expect(labels.map((l) => l.kind)).toEqual([kind]);
    }
  });

  it('does not touch the clean copy', () => {
    const base = generateShipment('T-2', 'CA', 11);
    const before = JSON.stringify(base);
    injectErrors(base, new Rng(3), 3);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('templates', () => {
  it('print the values the extraction will be scored on', () => {
    for (const { shipment } of dataset.slice(0, 40)) {
      const html = renderHtml(shipment);
      const { invoice, billOfLading } = shipment.documents;
      expect(html.invoice).toContain(invoice.invoiceNumber);
      expect(html['bill-of-lading']).toContain(billOfLading.blNumber);
      billOfLading.containers.forEach((c) => expect(html['bill-of-lading']).toContain(c.number));
      expect(html['bill-of-lading']).toContain(billOfLading.totalGrossWeight.raw.unit);
    }
  });
});

describe('ISF set (v1-isf)', () => {
  const isfSet = buildIsfDataset(dataset);

  it('covers every US shipment without changing the v1 dataset', () => {
    const before = JSON.stringify(dataset);
    expect(isfSet.map((e) => e.shipment.id)).toEqual(dataset.filter((e) => e.shipment.destination === 'US').map((e) => e.shipment.id));
    expect(JSON.stringify(buildIsfDataset(dataset))).toBe(JSON.stringify(isfSet));
    expect(JSON.stringify(dataset)).toBe(before);
    expect(dataset.every((e) => e.shipment.render.isfTemplate === undefined)).toBe(true);
    expect(isfSet.filter((e) => e.labels.some((l) => l.document === 'isf')).length).toBeGreaterThan(10);
  });

  it('X11 flags exactly the ISF errors the labels expect', () => {
    for (const { shipment, labels } of isfSet) {
      expect(Isf.safeParse(shipment.documents.isf).error).toBeUndefined();
      const expected = new Set(labels.flatMap((l) => l.expectedRuleIds));
      const got = new Set(runRules(context(shipment), {}, { only: V1_RULE_IDS }).findings.map((f) => f.ruleId));
      expect([shipment.id, [...got].sort()]).toEqual([shipment.id, [...expected].sort()]);
    }
  });

  it('the confirmation prints the ten elements', () => {
    for (const { shipment } of isfSet.slice(0, 20)) {
      const isf = shipment.documents.isf;
      const html = renderIsf(isf, shipment.documents.billOfLading, shipment.seed);
      for (const v of [isf.importerOfRecordNumber, isf.consigneeNumber, isf.countryOfOrigin, isf.htsCode.slice(0, 4), isf.consolidator.name, isf.containerStuffingLocation.country]) expect(html).toContain(v);
      for (const p of [isf.seller, isf.buyer, isf.manufacturer, isf.shipToParty]) expect(html).toContain(p.name.replace(/&/g, '&amp;'));
    }
  });
});
