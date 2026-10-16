import type { RuleConfig, RuleParamKey, RuleParamSpec, RuleSettings } from '../../api/types';

/** The form's state: switches and severities per rule, tolerances as typed (strings), known SCACs as typed. */
export interface RuleDraft {
  enabled: Record<string, boolean>;
  severity: Record<string, string>;
  params: Partial<Record<RuleParamKey, string>>;
  scacs: string;
}

/** A percent is stored as a fraction (0.005) and shown as a percentage (0.5). */
const toShown = (spec: RuleParamSpec, v: number) => (spec.unit === 'percent' ? Number((v * 100).toPrecision(6)) : v);
const fromShown = (spec: RuleParamSpec, v: number) => (spec.unit === 'percent' ? Number((v / 100).toPrecision(6)) : v);

export const shownBounds = (spec: RuleParamSpec) => ({ min: toShown(spec, spec.min), max: toShown(spec, spec.max) });

export const paramSpecs = (s: RuleSettings) => s.rules.flatMap((r) => r.params ?? []);

export function draftOf(s: RuleSettings): RuleDraft {
  const cfg = s.config;
  return {
    enabled: Object.fromEntries(s.rules.map((r) => [r.id, cfg.rules?.[r.id]?.enabled !== false])),
    severity: Object.fromEntries(s.rules.map((r) => [r.id, cfg.rules?.[r.id]?.severity ?? 'default'])),
    params: Object.fromEntries(paramSpecs(s).map((p) => [p.key, String(toShown(p, cfg.params?.[p.key] ?? s.defaults[p.key]))])),
    scacs: (cfg.params?.knownScacs ?? []).join(', '),
  };
}

export type DraftError = { key: RuleParamKey | 'scacs'; spec?: RuleParamSpec };

/** The config to save, or the first field that is not valid. */
export function configOf(s: RuleSettings, d: RuleDraft): { config: RuleConfig } | { error: DraftError } {
  const rules: NonNullable<RuleConfig['rules']> = {};
  for (const r of s.rules) {
    const entry = {
      ...(d.enabled[r.id] === false ? { enabled: false } : {}),
      ...(d.severity[r.id] && d.severity[r.id] !== 'default' ? { severity: d.severity[r.id] as RuleSettings['rules'][number]['severity'] } : {}),
    };
    if (Object.keys(entry).length) rules[r.id] = entry;
  }
  const params: NonNullable<RuleConfig['params']> = {};
  for (const spec of paramSpecs(s)) {
    const raw = (d.params[spec.key] ?? '').trim().replace(',', '.');
    const shown = Number(raw);
    const { min, max } = shownBounds(spec);
    if (!raw || !Number.isFinite(shown) || shown < min || shown > max || ((spec.unit === 'count' || spec.unit === 'days' || spec.unit === 'hours') && !Number.isInteger(shown))) {
      return { error: { key: spec.key, spec } };
    }
    const value = fromShown(spec, shown);
    if (value !== s.defaults[spec.key]) params[spec.key] = value;
  }
  const scacs = [...new Set(d.scacs.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  if (scacs.some((x) => !/^[A-Z]{2,4}$/.test(x))) return { error: { key: 'scacs' } };
  if (scacs.length) params.knownScacs = scacs.sort();
  return { config: { ...(Object.keys(rules).length ? { rules } : {}), ...(Object.keys(params).length ? { params } : {}) } };
}
