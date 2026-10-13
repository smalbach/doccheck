import { afterAll, describe, expect, it } from 'vitest';
import { runRules, type ShipmentContext } from '@doccheck/rules';
import { buildDataset } from './dataset';
import { ERROR_KINDS, EXTRA_ERROR_KINDS, injectErrors, type ErrorKind } from './errors';
import type { SyntheticShipment } from './generate';
import { Rng } from './rng';

// Recall of rules that dataset v1 has no injected errors for (X9, X12): each extra injector is applied
// alone to each of the 200 clean shipments, and the engine must flag the labeled rule, cite the labeled
// field, and raise nothing else (clean shipments raise nothing).

const context = (s: SyntheticShipment): ShipmentContext => ({
  shipmentId: s.id,
  destination: s.destination,
  invoice: { id: 'invoice', data: s.documents.invoice },
  packingList: { id: 'packingList', data: s.documents.packingList },
  billOfLading: { id: 'billOfLading', data: s.documents.billOfLading },
  isf: s.documents.isf ? { id: 'isf', data: s.documents.isf } : undefined,
});

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

const cleans = buildDataset().map((e) => e.clean);

interface Tally {
  kind: ErrorKind;
  rule: string;
  injected: number;
  tp: number;
  fn: number;
  fp: number;
  misses: string[];
}
const tallies: Tally[] = [];

describe('injectors outside v1', () => {
  it('are not part of the v1 kinds', () => {
    expect(EXTRA_ERROR_KINDS).toEqual(['onboard_date_shift', 'freight_terms_flipped']);
    expect(EXTRA_ERROR_KINDS.some((k) => ERROR_KINDS.includes(k))).toBe(false);
  });

  it.each(EXTRA_ERROR_KINDS.map((k) => [k] as const))('%s: the engine flags the labeled rule and nothing else', (kind) => {
    const t: Tally = { kind, rule: '', injected: 0, tp: 0, fn: 0, fp: 0, misses: [] };
    cleans.forEach((clean, i) => {
      const { shipment, labels } = injectErrors(clean, new Rng(0x9e37 + i), 1, [kind]);
      expect(labels).toHaveLength(1);
      const [label] = labels;
      expect(label.kind).toBe(kind);
      expect(label.expectedRuleIds).toHaveLength(1);
      t.rule = label.expectedRuleIds[0];
      t.injected++;
      const findings = runRules(context(shipment)).findings;
      const hit = findings
        .filter((f) => f.ruleId === t.rule)
        .some((f) => f.evidence.some((ev) => ev.documentId === label.document && ev.field === label.field && ev.value === label.after));
      if (hit) t.tp++;
      else {
        t.fn++;
        t.misses.push(`${shipment.id}: ${label.description}`);
      }
      // Precision: any other rule raised by the injection is a false positive.
      t.fp += findings.filter((f) => f.ruleId !== t.rule).length;
      expect([shipment.id, findings.map((f) => f.ruleId).filter((r) => r !== t.rule)]).toEqual([shipment.id, []]);

      // A miss is only acceptable when the shifted date still falls inside X9's 7-day tolerance.
      if (!hit) {
        expect(kind).toBe('onboard_date_shift');
        const gap = days(shipment.documents.billOfLading.shippedOnBoardDate!, shipment.documents.invoice.shipmentDate!);
        expect([shipment.id, Math.abs(gap) <= 7]).toEqual([shipment.id, true]);
      }
    });
    tallies.push(t);
    expect(t.injected).toBe(cleans.length);
    expect(t.fp).toBe(0);
    if (kind === 'freight_terms_flipped') expect(t.fn).toBe(0);
  });

  afterAll(() => {
    const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
    const lines = tallies.map(
      (t) => `${t.kind.padEnd(22)} ${t.rule.padEnd(4)} injected ${t.injected}  tp ${t.tp}  fn ${t.fn}  fp ${t.fp}  recall ${pct(t.tp, t.tp + t.fn)}  precision ${pct(t.tp, t.tp + t.fp)}`,
    );
    for (const t of tallies) for (const m of t.misses) lines.push(`  miss ${t.rule} ${m}`);
    console.log(`Rule coverage on injected errors outside v1 (ground truth):\n${lines.join('\n')}`);
  });
});
