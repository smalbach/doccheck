import type { DocumentType, Finding } from '@doccheck/schemas';
import { PROFILES } from './profiles';
import { ALL_RULES } from './registry';
import { DEFAULT_PARAMS, type RuleParams, type ShipmentContext } from './types';

export interface EngineOutput {
  findings: Finding[];
  ran: string[];
  /** Rules that could not run because a required document is missing. */
  skipped: { ruleId: string; missing: DocumentType[] }[];
}

const present = (ctx: ShipmentContext): Set<DocumentType> => {
  const s = new Set<DocumentType>();
  if (ctx.invoice) s.add('COMMERCIAL_INVOICE');
  if (ctx.packingList) s.add('PACKING_LIST');
  if (ctx.billOfLading) s.add('BILL_OF_LADING');
  if (ctx.isf) s.add('ISF');
  return s;
};

export function runRules(ctx: ShipmentContext, params: Partial<RuleParams> = {}): EngineOutput {
  const profile = PROFILES[ctx.destination];
  const p = { ...DEFAULT_PARAMS, ...params };
  const have = present(ctx);
  const output: EngineOutput = { findings: [], ran: [], skipped: [] };

  for (const rule of ALL_RULES) {
    const def = rule.definition;
    if (!profile.rules.includes(def.id)) continue;
    if (def.appliesTo !== 'ALL' && !def.appliesTo.includes(ctx.destination)) continue;
    const missing = def.requires.filter((t) => !have.has(t));
    if (missing.length > 0) {
      output.skipped.push({ ruleId: def.id, missing });
      continue;
    }
    output.ran.push(def.id);
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
  }
  return output;
}
