import type { EngineOutput, RuleProgress, ShipmentContext } from '@doccheck/rules';
import type { DocumentType, Finding } from '@doccheck/schemas';
import { TARIFF_RULES, type TariffContext } from './rules';

const present = (ctx: ShipmentContext): Set<DocumentType> =>
  new Set(
    ([['COMMERCIAL_INVOICE', ctx.invoice], ['PACKING_LIST', ctx.packingList], ['BILL_OF_LADING', ctx.billOfLading], ['ISF', ctx.isf]] as const)
      .filter(([, d]) => !!d)
      .map(([t]) => t),
  );

export interface TariffRunOptions {
  /** Called after each rule, like the rule engine's hook; `index` continues from `offset`. */
  onRule?: (progress: RuleProgress) => void;
  offset?: number;
  total?: number;
}

/**
 * Runs the tariff rules (H1-H3, P1, E1) the way the rule engine runs X/C/U rules, so their
 * findings join the same list. A rule that needs the schedule does not run without it: it goes
 * to `unavailable` instead, and the API says so.
 */
export function runTariffRules(ctx: ShipmentContext, tariff: TariffContext, { onRule, offset = 0, total }: TariffRunOptions = {}): EngineOutput & { unavailable: string[] } {
  const have = present(ctx);
  const output: EngineOutput & { unavailable: string[] } = { findings: [], ran: [], skipped: [], unavailable: [] };
  const count = total ?? offset + TARIFF_RULES.length;
  const notify = (p: RuleProgress) => {
    try {
      onRule?.(p);
    } catch {
      // Progress must not break the run.
    }
  };
  for (const [i, rule] of TARIFF_RULES.entries()) {
    const def = rule.definition;
    const at = { rule: def.id, index: offset + i + 1, total: count };
    const missing = def.requires.filter((t) => !have.has(t));
    if (missing.length > 0 || (rule.needsSchedule && !tariff.schedule)) {
      if (missing.length > 0) output.skipped.push({ ruleId: def.id, missing });
      else output.unavailable.push(def.id);
      notify({ ...at, skipped: true, findings: 0, found: [] });
      continue;
    }
    output.ran.push(def.id);
    const found: Finding[] = rule.run(ctx, tariff).map((r, k) => ({
      id: `${ctx.shipmentId}:${def.id}:${k}`,
      shipmentId: ctx.shipmentId,
      ruleId: def.id,
      severity: r.severity ?? def.severity,
      decidedBy: 'RULE',
      message: r.message,
      evidence: r.evidence,
      ...(r.suggestedFix ? { suggestedFix: r.suggestedFix } : {}),
      ...(r.regulation ? { regulation: r.regulation } : {}),
    }));
    output.findings.push(...found);
    notify({ ...at, skipped: false, findings: found.length, found });
  }
  return output;
}

/** How many rules runTariffRules reports, for progress totals. */
export const TARIFF_RULE_COUNT = TARIFF_RULES.length;
