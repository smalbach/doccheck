import type { EngineOutput, RuleConfig, RuleProgress, ShipmentContext } from '@doccheck/rules';
import type { Destination, DocumentType, Finding } from '@doccheck/schemas';
import { TARIFF_RULES, type TariffContext } from './rules';

const present = (ctx: ShipmentContext): Set<DocumentType> =>
  new Set(
    ([['COMMERCIAL_INVOICE', ctx.invoice], ['PACKING_LIST', ctx.packingList], ['BILL_OF_LADING', ctx.billOfLading], ['ISF', ctx.isf]] as const)
      .filter(([, d]) => !!d)
      .map(([t]) => t),
  );

export interface TariffRunOutput extends EngineOutput {
  /** H4 and H5: what the entry may also need, cited like findings but never open. */
  notices: Finding[];
  /** Rules that need the schedule, not run without it. */
  unavailable: string[];
}

export interface TariffRunOptions {
  /** Called after each rule, like the rule engine's hook; `index` continues from `offset`. */
  onRule?: (progress: RuleProgress) => void;
  offset?: number;
  total?: number;
  /** The organization's rule settings: rules turned off, a different severity (same as the rule engine). */
  config?: RuleConfig;
}

const off = (config: RuleConfig | undefined, id: string) => config?.rules?.[id]?.enabled === false;

/** The tariff rules that apply to a destination, in order (H2, H4, H5 and A2 only where a schedule is loaded: CA, US). */
export const tariffRulesFor = (destination: Destination) => TARIFF_RULES.filter((r) => r.definition.appliesTo === 'ALL' || r.definition.appliesTo.includes(destination));

/** How many rules runTariffRules reports for a destination and settings, for progress totals. */
export const tariffRuleCount = (destination: Destination, config?: RuleConfig) => tariffRulesFor(destination).filter((r) => !off(config, r.definition.id)).length;

/**
 * Runs the tariff rules (H1-H5) the way the rule engine runs X/C/U rules. H1-H3 findings
 * join the same list; H4 and H5 (informational) come back as `notices`, in the same shape, for the
 * tariff report. A rule that needs the schedule does not run without it: it goes to `unavailable`
 * instead, and the API says so.
 */
export function runTariffRules(ctx: ShipmentContext, tariff: TariffContext, { onRule, offset = 0, total, config }: TariffRunOptions = {}): TariffRunOutput {
  const have = present(ctx);
  const applicable = tariffRulesFor(ctx.destination);
  const rules = applicable.filter((r) => !off(config, r.definition.id));
  const output: TariffRunOutput = { findings: [], notices: [], ran: [], skipped: [], disabled: applicable.filter((r) => off(config, r.definition.id)).map((r) => r.definition.id), unavailable: [] };
  const count = total ?? offset + rules.length;
  const notify = (p: RuleProgress) => {
    try {
      onRule?.(p);
    } catch {
      // Progress must not break the run.
    }
  };
  for (const [i, rule] of rules.entries()) {
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
      severity: config?.rules?.[def.id]?.severity ?? r.severity ?? def.severity,
      decidedBy: 'RULE',
      message: r.message,
      evidence: r.evidence,
      ...(r.suggestedFix ? { suggestedFix: r.suggestedFix } : {}),
      ...(r.regulation ? { regulation: r.regulation } : {}),
    }));
    if (rule.informational) {
      output.notices.push(...found);
      notify({ ...at, skipped: false, findings: 0, found: [] });
      continue;
    }
    output.findings.push(...found);
    notify({ ...at, skipped: false, findings: found.length, found });
  }
  return output;
}

