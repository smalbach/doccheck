import type { DocumentType, Finding } from '@doccheck/schemas';
import { PROFILES } from './profiles';
import { ALL_RULES } from './registry';
import { CONTEXT_SLOTS, DEFAULT_PARAMS, type ContextSlot, type RuleParams, type ShipmentContext } from './types';

export interface EngineOutput {
  findings: Finding[];
  ran: string[];
  /** Rules that could not run because a required document is missing. */
  skipped: { ruleId: string; missing: DocumentType[] }[];
  /**
   * Rules that do not apply to this shipment: about a document it does not have (optional rules), or
   * ocean rules on an air shipment. Neither a finding nor missing input.
   */
  notApplicable?: string[];
}

const present = (ctx: ShipmentContext): Set<DocumentType> =>
  new Set((Object.keys(CONTEXT_SLOTS) as ContextSlot[]).filter((slot) => ctx[slot]).map((slot) => CONTEXT_SLOTS[slot]));

/** Documents only an ocean shipment has: on an air waybill without a bill of lading, rules needing them do not apply. */
const OCEAN_ONLY: DocumentType[] = ['BILL_OF_LADING', 'ISF'];

/** One rule evaluated, for progress reporting: `index` (1-based) of `total` rules that apply to the destination. */
export interface RuleProgress {
  rule: string;
  index: number;
  total: number;
  skipped: boolean;
  /** Skipped because it does not apply to this shipment (EngineOutput.notApplicable), not for missing input. */
  notApplicable?: boolean;
  findings: number;
  /** The findings this rule produced (already in the output, in order). */
  found: readonly Finding[];
}

export interface RunOptions {
  /** Called after each rule, in order. Errors it throws are ignored. */
  onRule?: (progress: RuleProgress) => void;
}

export function runRules(ctx: ShipmentContext, params: Partial<RuleParams> = {}, { onRule }: RunOptions = {}): EngineOutput {
  const profile = PROFILES[ctx.destination];
  const p = { ...DEFAULT_PARAMS, ...params };
  const have = present(ctx);
  const output: EngineOutput = { findings: [], ran: [], skipped: [], notApplicable: [] };
  const air = !!ctx.airWaybill && !ctx.billOfLading;
  const rules = ALL_RULES.filter(({ definition: def }) => profile.rules.includes(def.id) && (def.appliesTo === 'ALL' || def.appliesTo.includes(ctx.destination)));
  const notify = (progress: RuleProgress) => {
    try {
      onRule?.(progress);
    } catch {
      // Progress must not break the run.
    }
  };

  for (const [i, rule] of rules.entries()) {
    const def = rule.definition;
    const missing = def.requires.filter((t) => !have.has(t));
    const noneOf = !!def.requiresAny?.length && !def.requiresAny.some((t) => have.has(t));
    if ((air && missing.some((t) => OCEAN_ONLY.includes(t))) || (def.optional && (missing.length > 0 || noneOf || rule.applies?.(ctx) === false))) {
      output.notApplicable!.push(def.id);
      notify({ rule: def.id, index: i + 1, total: rules.length, skipped: true, notApplicable: true, findings: 0, found: [] });
      continue;
    }
    if (noneOf) missing.push(...def.requiresAny!);
    if (missing.length > 0) {
      output.skipped.push({ ruleId: def.id, missing });
      notify({ rule: def.id, index: i + 1, total: rules.length, skipped: true, findings: 0, found: [] });
      continue;
    }
    output.ran.push(def.id);
    const before = output.findings.length;
    rule.run(ctx, p).forEach((r, i) => {
      output.findings.push({
        id: `${ctx.shipmentId}:${def.id}:${i}`,
        shipmentId: ctx.shipmentId,
        ruleId: def.id,
        severity: r.severity ?? def.severity,
        decidedBy: 'RULE',
        message: r.message,
        evidence: r.evidence,
        suggestedFix: r.suggestedFix,
      });
    });
    const found = output.findings.slice(before);
    notify({ rule: def.id, index: i + 1, total: rules.length, skipped: false, findings: found.length, found });
  }
  return output;
}
