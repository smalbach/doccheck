/** What is metered: documents extracted by the model, and validation runs. */
export const USAGE_KINDS = ['extraction', 'validation'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export type Enforcement = 'soft' | 'hard';

export interface Plan {
  id: string;
  name: string;
  position: number;
  /** null: unlimited. */
  extractionsPerMonth: number | null;
  validationsPerMonth: number | null;
  /** Percent of a limit at which the web starts warning (the soft limit). */
  warnPercent: number;
  /** At the limit: 'hard' refuses more work, 'soft' lets it through and shows the overage. */
  enforcement: Enforcement;
}

/**
 * ok: under the warning threshold. warning: at or past it, still under the limit. over: at or past
 * the limit on a soft plan (work goes on). blocked: at the limit on a hard plan (work is refused).
 */
export type MeterState = 'ok' | 'warning' | 'over' | 'blocked';

export interface Meter {
  kind: UsageKind;
  used: number;
  limit: number | null;
  /** null when unlimited; never negative. */
  remaining: number | null;
  /** Whole percent of the limit used (floored), null when unlimited. */
  percent: number | null;
  state: MeterState;
}

export const limitOf = (plan: Plan, kind: UsageKind): number | null => (kind === 'extraction' ? plan.extractionsPerMonth : plan.validationsPerMonth);

/** Counts are integers, so the percent is integer arithmetic too. */
export function meter(plan: Plan, kind: UsageKind, used: number): Meter {
  const limit = limitOf(plan, kind);
  if (limit === null) return { kind, used, limit, remaining: null, percent: null, state: 'ok' };
  // A limit of 0 means none of it is included: always at 100%.
  const percent = limit === 0 ? 100 : Math.floor((used * 100) / limit);
  const remaining = Math.max(0, limit - used);
  let state: MeterState = 'ok';
  if (used >= limit) state = plan.enforcement === 'hard' ? 'blocked' : 'over';
  else if (percent >= plan.warnPercent) state = 'warning';
  return { kind, used, limit, remaining, percent, state };
}

/**
 * Whether `adding` more units may start now. A hard plan refuses anything that would go past the
 * limit (5 PDFs with 3 left are refused as a whole, so an upload is never half accepted).
 */
export function allows(plan: Plan, kind: UsageKind, used: number, adding = 1): boolean {
  const limit = limitOf(plan, kind);
  return limit === null || plan.enforcement === 'soft' || used + adding <= limit;
}

/** First day of the month of `at`, UTC, as YYYY-MM-DD: the key of a usage counter. */
export function monthOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** When the counters of `at`'s month start again (first day of the next month, 00:00 UTC). */
export function nextMonth(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
}
