import { Severity } from '@doccheck/schemas';
import { z } from 'zod';
import { ALL_RULES } from './registry';
import { DEFAULT_PARAMS, type NumericParam, type ParamSpec, type RuleConfig, type RuleParams } from './types';

const SCAC = z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, 'A SCAC is 2 to 4 letters');

/** A rule configuration as stored and as the settings API accepts it. Unknown rule ids are refused. */
export const RuleConfigSchema = z
  .object({
    rules: z.record(z.string(), z.object({ enabled: z.boolean().optional(), severity: Severity.optional() }).strict()).optional(),
    params: z
      .object({
        ...Object.fromEntries(
          (Object.keys(DEFAULT_PARAMS) as (keyof RuleParams)[]).filter((k) => typeof DEFAULT_PARAMS[k] === 'number').map((k) => [k, z.number().finite().optional()]),
        ),
        knownScacs: z.array(SCAC).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const ids = new Set(ALL_RULES.map((r) => r.definition.id));
    for (const id of Object.keys(cfg.rules ?? {})) if (!ids.has(id)) ctx.addIssue({ code: 'custom', path: ['rules', id], message: `Unknown rule ${id}` });
    const specs = paramSpecs();
    for (const [key, value] of Object.entries(cfg.params ?? {})) {
      const spec = specs.get(key as NumericParam);
      if (typeof value === 'number' && spec && (value < spec.min || value > spec.max)) {
        ctx.addIssue({ code: 'custom', path: ['params', key], message: `${key} must be between ${spec.min} and ${spec.max}` });
      }
    }
  });

/** Every tunable parameter, with the bounds of the rule that declares it. */
export function paramSpecs(): Map<NumericParam, ParamSpec> {
  return new Map(ALL_RULES.flatMap((r) => r.definition.params ?? []).map((p) => [p.key, p]));
}

/**
 * The smallest config with the same effect: entries equal to the default are dropped, so a stored
 * config never pins a default the code may later improve, and an empty config means "defaults".
 */
export function compactRuleConfig(cfg: RuleConfig): RuleConfig {
  const defaults = new Map(ALL_RULES.map((r) => [r.definition.id, r.definition.severity]));
  const rules: NonNullable<RuleConfig['rules']> = {};
  for (const [id, r] of Object.entries(cfg.rules ?? {})) {
    const entry = {
      ...(r.enabled === false ? { enabled: false } : {}),
      ...(r.severity && r.severity !== defaults.get(id) ? { severity: r.severity } : {}),
    };
    if (Object.keys(entry).length) rules[id] = entry;
  }
  const params: Partial<RuleParams> = {};
  for (const [k, v] of Object.entries(cfg.params ?? {}) as [keyof RuleParams, unknown][]) {
    if (k === 'knownScacs') {
      const list = [...new Set((v as string[]).map((s) => s.trim().toUpperCase()))].sort();
      if (list.length) params.knownScacs = list;
    } else if (typeof v === 'number' && v !== DEFAULT_PARAMS[k]) {
      (params as Record<string, number>)[k] = v;
    }
  }
  return { ...(Object.keys(rules).length ? { rules } : {}), ...(Object.keys(params).length ? { params } : {}) };
}
