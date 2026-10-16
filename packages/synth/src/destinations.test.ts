import { describe, expect, it } from 'vitest';
import { isValidEuEori, isValidGbEori, isValidRfc, runRules, V1_RULE_IDS, type ShipmentContext } from '@doccheck/rules';
import { BillOfLading, CommercialInvoice, PackingList } from '@doccheck/schemas';
import { buildDataset, V3_DESTINATIONS } from './dataset';
import { DESTINATION_ERROR_KINDS, injectErrors } from './errors';
import type { SyntheticShipment } from './generate';
import { renderHtml } from './pdf';
import { Rng } from './rng';
import { RULES_SET_PARAMS } from './rules-set';

// Injected errors are labeled for the rules the set was written for; rules added after v1 have set v1-rules.
const ONLY = { only: [...V1_RULE_IDS, 'M1', 'M2', 'M3', 'E1', 'E2', 'E3', 'K1', 'K2', 'K3'] };

const context = (s: SyntheticShipment): ShipmentContext => ({
  shipmentId: s.id,
  destination: s.destination,
  invoice: { id: 'invoice', data: s.documents.invoice },
  packingList: { id: 'packingList', data: s.documents.packingList },
  billOfLading: { id: 'billOfLading', data: s.documents.billOfLading },
});

const v3 = buildDataset(V3_DESTINATIONS);

describe('dataset v3-destinations', () => {
  it('has 30 shipments per destination and is reproducible', () => {
    for (const d of ['MX', 'EU', 'GB']) expect(v3.filter((e) => e.shipment.destination === d)).toHaveLength(V3_DESTINATIONS.perCountry);
    expect(JSON.stringify(buildDataset(V3_DESTINATIONS))).toBe(JSON.stringify(v3));
  });

  it('clean shipments match the schemas, carry valid importer numbers and pass every rule', () => {
    for (const { clean: s } of v3) {
      expect(CommercialInvoice.safeParse(s.documents.invoice).error).toBeUndefined();
      expect(PackingList.safeParse(s.documents.packingList).error).toBeUndefined();
      expect(BillOfLading.safeParse(s.documents.billOfLading).error).toBeUndefined();
      const id = s.documents.invoice.buyer.taxId!;
      expect({ MX: isValidRfc, EU: isValidEuEori, GB: isValidGbEori }[s.destination as 'MX' | 'EU' | 'GB'](id), `${s.id} ${id}`).toBe(true);
      // An import crosses a customs border: no EU seller for the EU.
      if (s.destination === 'EU') expect(['CN', 'VN', 'IN', 'CO', 'PE', 'TR']).toContain(s.documents.invoice.seller.address.country);
      expect(runRules(context(s), RULES_SET_PARAMS).findings).toEqual([]);
    }
  });

  it('every labeled error is caught by its rule, with no other finding on the shipment', () => {
    for (const e of v3) {
      const got = new Set(runRules(context(e.shipment), RULES_SET_PARAMS, ONLY).findings.map((f) => f.ruleId));
      const expected = new Set(e.labels.flatMap((l) => l.expectedRuleIds));
      expect([...got].sort(), e.shipment.id).toEqual([...expected].sort());
    }
  });

  it('each destination error kind is caught when injected alone', () => {
    for (const kind of DESTINATION_ERROR_KINDS) {
      let injected = 0;
      v3.forEach(({ clean }, i) => {
        const { shipment, labels } = injectErrors(clean, new Rng(0x51ed + i), 1, [kind]);
        for (const l of labels) {
          injected++;
          const findings = runRules(context(shipment), RULES_SET_PARAMS, ONLY).findings;
          expect(findings.map((f) => f.ruleId), `${kind} ${clean.id}`).toEqual(l.expectedRuleIds);
        }
      });
      expect(injected, kind).toBeGreaterThan(0);
    }
  });

  it('prints the statement on origin on UK invoices for EU goods', () => {
    const gb = v3.find((e) => e.clean.documents.invoice.originStatement)!;
    expect(renderHtml(gb.clean).invoice).toContain('preferential origin');
  });
});
