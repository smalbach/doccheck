import type { CommercialInvoice, Severity } from '@doccheck/schemas';
import type { RuleResult, ShipmentContext } from '../types';

/**
 * A field the destination's customs authority expects on the commercial invoice.
 * `ref` is the field number on CBSA form CI1 or the paragraph of 19 CFR 141.86 (same mapping as the
 * schema comments); the agent attaches the regulation text in phase 4.
 */
export interface RequiredField {
  /** Path reported as evidence. "lines[*].x" is checked on every line. */
  path: string;
  label: string;
  ref: string;
  severity: Severity;
  /** Overrides the default "value is present" check. */
  present?: (inv: CommercialInvoice) => boolean;
}

const filled = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => (cur === null || cur === undefined ? undefined : (cur as Record<string, unknown>)[key]), obj);
}

/** One finding per missing field; per-line fields report the lines that lack them. */
export function checkRequired(ctx: ShipmentContext, fields: RequiredField[], authority: string): RuleResult[] {
  if (!ctx.invoice) return [];
  const { id, data } = ctx.invoice;
  const results: RuleResult[] = [];
  for (const f of fields) {
    if (f.path.startsWith('lines[*].')) {
      const sub = f.path.slice('lines[*].'.length);
      const missing = data.lines.map((l, i) => ({ l, i })).filter(({ l }) => !filled(get(l, sub)));
      if (missing.length === 0) continue;
      results.push({
        severity: f.severity,
        message: `${f.label} is missing on ${missing.length === data.lines.length ? 'every invoice line' : `line(s) ${missing.map((m) => m.l.lineNo).join(', ')}`} (${authority} ${f.ref}).`,
        evidence: missing.map(({ i }) => ({ documentId: id, field: `lines[${i}].${sub}`, value: '' })),
        suggestedFix: `Ask the shipper for a corrected invoice that states the ${f.label.toLowerCase()}.`,
      });
      continue;
    }
    const ok = f.present ? f.present(data) : filled(get(data, f.path));
    if (ok) continue;
    results.push({
      severity: f.severity,
      message: `${f.label} is missing from the commercial invoice (${authority} ${f.ref}).`,
      evidence: [{ documentId: id, field: f.path, value: '' }],
      suggestedFix: `Ask the shipper for a corrected invoice that states the ${f.label.toLowerCase()}.`,
    });
  }
  return results;
}
