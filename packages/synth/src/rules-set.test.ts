import { afterAll, describe, expect, it } from 'vitest';
import { BillOfLading, CommercialInvoice, Isf } from '@doccheck/schemas';
import { buildDataset } from './dataset';
import { completeForRules, evaluateRulesSet, RULES_ERROR_KINDS, type RulesTally } from './rules-set';

// Set v1-rules: the rules added after v1, on the 200 clean v1 shipments completed with what those
// rules read, one injected error kind at a time. Ground truth only.

const dataset = buildDataset();
const cleans = dataset.map((e) => e.clean);
const { tallies, cleanFindings } = evaluateRulesSet(cleans);

describe('set v1-rules', () => {
  it('completes shipments without touching v1 and keeps them schema-valid', () => {
    const before = JSON.stringify(dataset);
    for (const clean of cleans.slice(0, 40)) {
      const { shipment } = completeForRules(clean);
      expect(CommercialInvoice.safeParse(shipment.documents.invoice).error).toBeUndefined();
      expect(BillOfLading.safeParse(shipment.documents.billOfLading).error).toBeUndefined();
      if (shipment.documents.isf) expect(Isf.safeParse(shipment.documents.isf).error).toBeUndefined();
    }
    expect(JSON.stringify(dataset)).toBe(before);
  });

  it('completed clean shipments raise nothing under every rule', () => {
    expect(cleanFindings).toEqual([]);
  });

  it.each(RULES_ERROR_KINDS.map((k) => [k] as const))('%s: the engine flags the labeled rules and nothing else', (kind) => {
    const t = tallies.find((x) => x.kind === kind)!;
    expect(t.injected).toBeGreaterThan(0);
    expect([kind, t.extras.slice(0, 3)]).toEqual([kind, []]);
    expect([kind, t.misses.slice(0, 3)]).toEqual([kind, []]);
  });

  afterAll(() => {
    const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
    const line = (t: RulesTally) =>
      `${t.kind.padEnd(24)} ${t.rules.join('+').padEnd(8)} injected ${t.injected}  tp ${t.tp}  fn ${t.fn}  fp ${t.fp}  recall ${pct(t.tp, t.tp + t.fn)}  precision ${pct(t.tp, t.tp + t.fp)}`;
    console.log(`Rules added after v1, on set v1-rules (ground truth):\n${tallies.map(line).join('\n')}`);
  });
});
