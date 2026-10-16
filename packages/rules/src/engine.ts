import type { DocumentType, Finding } from '@doccheck/schemas';
import { PROFILES } from './profiles';
import { ALL_RULES } from './registry';
import { DEFAULT_PARAMS, type RuleConfig, type RuleParams, type ShipmentContext } from './types';

export interface EngineOutput {
  findings: Finding[];
  ran: string[];
  /** Rules that could not run because a required document is missing. */
  skipped: { ruleId: string; missing: DocumentType[] }[];
  /** Rules of the profile the account turned off (RuleConfig). */
  disabled: string[];
}

const present = (ctx: ShipmentContext): Set<DocumentType> => {
  const s = new Set<DocumentType>();
  if (ctx.invoice) s.add('COMMERCIAL_INVOICE');
  if (ctx.packingList) s.add('PACKING_LIST');
  if (ctx.billOfLading) s.add('BILL_OF_LADING');
  if (ctx.isf) s.add('ISF');
  return s;
};

/** One rule evaluated, for progress reporting: `index` (1-based) of `total` rules that apply to the destination. */
export interface RuleProgress {
  rule: string;
  index: number;
  total: number;
  skipped: boolean;
  findings: number;
  /** The findings this rule produced (already in the output, in order). */
  found: readonly Finding[];
}

export interface RunOptions {
  /** Called after each rule, in order. Errors it throws are ignored. */
  onRule?: (progress: RuleProgress) => void;
  /** The account's changes to the defaults: rules off, severities, tolerances (over `params`). */
  config?: RuleConfig;
  /** Run only these rules (still filtered by the profile), e.g. the rules an evaluation set is labeled for. */
  only?: readonly string[];
}

export function runRules(ctx: ShipmentContext, params: Partial<RuleParams> = {}, { onRule, config, only }: RunOptions = {}): EngineOutput {
  const profile = PROFILES[ctx.destination];
  const p = { ...DEFAULT_PARAMS, ...params, ...config?.params };
  const have = present(ctx);
  const output: EngineOutput = { findings: [], ran: [], skipped: [], disabled: [] };
  const applicable = ALL_RULES.filter(
    ({ definition: def }) => profile.rules.includes(def.id) && (def.appliesTo === 'ALL' || def.appliesTo.includes(ctx.destination)) && (!only || only.includes(def.id)),
  );
  const off = (id: string) => config?.rules?.[id]?.enabled === false;
  output.disabled = applicable.filter((r) => off(r.definition.id)).map((r) => r.definition.id);
  const rules = applicable.filter((r) => !off(r.definition.id));
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
        severity: config?.rules?.[def.id]?.severity ?? r.severity ?? def.severity,
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
